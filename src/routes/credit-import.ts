import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { csrfFor, csrfValid } from "../http/cookies";
import { authForm, formText, readBoundedBody } from "../http/validation";
import { consumeAccountLimit } from "../middleware/request-limits";
import { creditTemplate } from "../generated/credit-template";
import { IMPORT_SCHEMA, ImportError, csv, templateCsv, type ImportBatch } from "../services/credit-import/schema";
import { parseImport } from "../services/credit-import/parser";
import {
  createPreview,
  getBatch,
  memberChoices,
  resolvePreview,
  target,
  type Decision,
} from "../services/credit-import/store";
import { commitImport, rollbackImport } from "../services/credit-import/commit";
import { importUploadPage, importHistoryPage, importBatchPage } from "../views/credit-import";

export const creditImportRoutes = new Hono<AppEnv>();
creditImportRoutes.use("*", async (c, next) => {
  if (
    !c.req.path.startsWith("/admin/credit-imports") &&
    !/^\/admin\/productions\/[^/]+\/credits\/import(?:\/|$)/.test(c.req.path)
  )
    return next();
  c.header("Cache-Control", "private, no-store");
  if (c.get("user")?.role !== "admin") return c.text("仅管理员可导入。", 403);
  await next();
});
creditImportRoutes.onError((err) => {
  if (err instanceof ImportError) throw new HTTPException(err.status, { message: err.message });
  throw err;
});
const positive = (value: string | undefined) => {
  if (!value || !/^\d{1,12}$/.test(value) || Number(value) < 1) throw new ImportError("参数不正确。");
  return Number(value);
};
const base = "/admin/productions/:id/credits/import";
const batchBase = "/admin/credit-imports";

creditImportRoutes.get(base, async (c) => {
  const id = positive(c.req.param("id"));
  const production = await c.env.DB.prepare("SELECT id,title FROM production WHERE id=?")
    .bind(id)
    .first<{ id: number; title: string }>();
  if (!production) throw new ImportError("作品不存在。", 404);
  const editions = (
    await c.env.DB.prepare(
      "SELECT id,name,year FROM production_edition WHERE production_id=? ORDER BY year DESC,id DESC",
    )
      .bind(id)
      .all<{ id: number; name: string; year: number | null }>()
  ).results;
  return c.html(importUploadPage(production, editions, await csrfFor(c)));
});
for (const extension of ["csv", "xlsx"]) {
  creditImportRoutes.get(`${base}/template.${extension}`, async (c) => {
    const exists = await c.env.DB.prepare("SELECT id FROM production WHERE id=?")
      .bind(positive(c.req.param("id")))
      .first();
    if (!exists) throw new ImportError("作品不存在。", 404);
    c.header("Content-Disposition", `attachment; filename="production-credit-import-v1.${extension}"`);
    c.header(
      "Content-Type",
      extension === "csv"
        ? "text/csv; charset=utf-8"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    return c.body(extension === "csv" ? templateCsv() : Uint8Array.from(atob(creditTemplate), (s) => s.charCodeAt(0)));
  });
}
creditImportRoutes.post(`${base}/preview`, async (c) => {
  const id = positive(c.req.param("id"));
  const bytes = await readBoundedBody(c.req.raw, IMPORT_SCHEMA.maxBytes + 16384);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "Content-Type": c.req.header("Content-Type") || "" } }).formData();
  } catch {
    throw new ImportError("上传表单无法解析。");
  }
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
  const t = await target(c.env.DB, id, positive(formText(form, "edition_id")));
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1) throw new ImportError("请选择一份表格。");
  const retry = await consumeAccountLimit(c, "credit-import", 30);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("上传次数较多，请稍后再试。", 429);
  }
  const rows = await parseImport(file);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const batch = await createPreview(
    c.env.DB,
    t,
    c.get("user")!,
    file.name.replace(/[\u0000-\u001f]/g, "").slice(0, 180),
    hash,
    rows,
  );
  return c.redirect(`${batchBase}/${batch}`, 303);
});
creditImportRoutes.get(batchBase, async (c) => {
  const page = Math.min(positive(c.req.query("page") || "1"), 10000);
  const rows = (
    await c.env.DB.prepare("SELECT * FROM credit_import_batch ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?")
      .bind((page - 1) * 20)
      .all<ImportBatch>()
  ).results;
  return c.html(importHistoryPage(rows, page));
});
creditImportRoutes.get(`${batchBase}/:batchId`, async (c) => {
  const { batch, rows } = await getBatch(c.env.DB, c.req.param("batchId"));
  const q = (c.req.query("q") || "").slice(0, 80);
  const [members, events, changes] = await Promise.all([
    ["preview", "ready"].includes(batch.status) ? memberChoices(c.env.DB, q) : Promise.resolve([]),
    c.env.DB.prepare(
      "SELECT actor_name,summary,created_at FROM credit_import_event WHERE batch_id=? ORDER BY id DESC LIMIT 100",
    )
      .bind(batch.id)
      .all<{ actor_name: string; summary: string; created_at: string }>(),
    c.env.DB.prepare("SELECT member_id,change_type,outcome FROM credit_import_member_change WHERE batch_id=?")
      .bind(batch.id)
      .all<{ member_id: number; change_type: string; outcome: string }>(),
  ]);
  return c.html(importBatchPage(batch, rows, members, events.results, changes.results, await csrfFor(c), q));
});
creditImportRoutes.get(`${batchBase}/:batchId/errors.csv`, async (c) => {
  const { batch, rows } = await getBatch(c.env.DB, c.req.param("batchId"));
  if (batch.details_purged) throw new ImportError("明细已到期清理。", 404);
  c.header("Content-Disposition", 'attachment; filename="credit-import-report.csv"');
  c.header("Content-Type", "text/csv; charset=utf-8");
  return c.body(
    csv([
      ["原表行号", ...IMPORT_SCHEMA.fields.map((f) => f.title), "原因"],
      ...rows
        .filter((r) => r.error_code)
        .map((r) => [
          r.row_number,
          r.member_name,
          r.external_id,
          r.kind === "cast" ? "演员" : r.kind === "crew" ? "后台与创作" : r.kind,
          r.role_name,
          r.error_message,
        ]),
    ]),
  );
});
for (const action of ["resolve", "confirm", "rollback"] as const) {
  creditImportRoutes.post(`${batchBase}/:batchId/${action}`, async (c) => {
    const form = await authForm(c);
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
    const { batch, rows } = await getBatch(c.env.DB, c.req.param("batchId"));
    const actor = c.get("user")!;
    if (
      (action === "confirm" && batch.status === "committed") ||
      (action === "rollback" && batch.status === "rolled_back")
    )
      return c.redirect(`${batchBase}/${batch.id}`, 303);
    if (formText(form, "revision") !== String(batch.revision))
      throw new ImportError("批次已更新，请刷新预览后再操作。", 409);
    if (action === "resolve") {
      const decisions: Record<number, Decision> = {};
      for (const row of rows) {
        const value = formText(form, `decision_${row.row_number}`);
        if (!value || value === "keep") continue;
        if (["auto", "create", "skip"].includes(value))
          decisions[row.row_number] = { action: value as Decision["action"] };
        else if (/^match:\d+$/.test(value))
          decisions[row.row_number] = { action: "match", memberId: positive(value.slice(6)) };
        else throw new ImportError("人员选择不正确。");
      }
      await resolvePreview(c.env.DB, batch, rows, decisions, actor);
    } else {
      if (formText(form, "confirm") !== "yes") throw new ImportError("请先勾选确认。");
      if (action === "confirm") await commitImport(c.env.DB, batch, actor);
      else await rollbackImport(c.env.DB, batch, actor);
    }
    return c.redirect(`${batchBase}/${batch.id}`, 303);
  });
}
