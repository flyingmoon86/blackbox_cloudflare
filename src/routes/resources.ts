import type { EditionRow } from "./productions";
import { productionVisible, resourceVisible } from "../services/production-visibility";
import { reviewRequest } from "../services/reviews";
import { pageNumber } from "../views/shared";
import { adminPage, filterChoice, likeTerm, safeListReturn, searchTerm } from "../http/pagination";
import { canViewResource, serveResourceFile } from "../services/resource-files";
import { fileCleanupStatements, drainFileCleanup } from "../services/file-cleanup";
import { invalidateSiteProfile } from "../services/site-profile";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import {
  resourceAdminPage,
  resourceDetailPage,
  resourceEditPage,
  resourceFormPage,
  resourceListPage,
  resourcePermissionPage,
  resourceReviewsPage,
} from "../views/resources";

export type ResourceRow = {
  edition_id?: number | null;
  edition_name?: string | null;
  id: number;
  title: string;
  res_type: string;
  description: string;
  original_name: string;
  preview_filename: string;
  status: string;
  admin_note: string;
  created_at: string;
  production_id: number | null;
  production_title: string | null;
  uploader_id: number | null;
  uploader_name: string | null;
};
export type PhotoNavigation = {
  previous_id: number | null;
  next_id: number | null;
  position: number;
  total: number;
};
export const resourceRoutes = new Hono<AppEnv>();
resourceRoutes.use("*", async (c, next) => {
  const target = /^\/resources\/([^/]+)(?:\/|$)/.exec(c.req.path);
  // Check the parent before login redirects, uploader access, HEAD, Range or cached bytes.
  if (
    target &&
    target[1] !== "submit" &&
    (!Number.isSafeInteger(Number(target[1])) ||
      !(await c.env.DB.prepare(`SELECT id FROM resource WHERE id=? AND ${resourceVisible(c)}`)
        .bind(Number(target[1]))
        .first()))
  )
    return c.text("资料不存在。", 404);
  if (
    !c.req.path.startsWith("/resources") &&
    c.req.path !== "/my-resources" &&
    !c.req.path.startsWith("/admin/resources")
  )
    return next();
  if (
    !c.get("user") &&
    !((c.req.method === "GET" || c.req.method === "HEAD") && /^\/resources(?:\/\d+(?:\/preview)?)?$/.test(c.req.path))
  )
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});
const adminDenied = (c: any) => (c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403));

function adminResourceFilter(raw: Record<string, string>, pending = false) {
  const params = {
    q: searchTerm(raw.q),
    year: /^[1-9]\d{0,3}$/.test(raw.year || "") ? raw.year : "",
    status: pending ? "pending" : filterChoice(raw.status, ["pending", "approved", "rejected"]),
    type: filterChoice(raw.type, ["photo", "script", "audio", "video", "other"]),
  };
  const clauses: string[] = [],
    values: (string | number)[] = [];
  if (params.q) {
    clauses.push("(r.title LIKE ? ESCAPE '\\' OR r.original_name LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')");
    values.push(...Array(3).fill(likeTerm(params.q)));
  }
  if (params.year) {
    clauses.push("COALESCE(e.year,p.year)=?");
    values.push(Number(params.year));
  }
  if (params.status) {
    clauses.push("r.status=?");
    values.push(params.status);
  }
  if (params.type) {
    clauses.push("r.res_type=?");
    values.push(params.type);
  }
  const from =
    " FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN production_edition e ON e.id=r.edition_id LEFT JOIN user u ON u.id=r.uploader_id";
  return { params, values, from: from + (clauses.length ? " WHERE " + clauses.join(" AND ") : "") };
}
const adminResourceColumns =
  "SELECT r.edition_id,COALESCE(e.year,'')||' · '||e.name edition_name,r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name";

resourceRoutes.get("/resources", async (c) => {
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const base = `SELECT r.edition_id,(SELECT COALESCE(year,'')||' · '||name FROM production_edition WHERE id=r.edition_id) edition_name,r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name
    FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id
    WHERE r.status='approved' AND r.res_type<>'photo' AND ${resourceVisible(c, "r")}`;
  const order = ` ORDER BY CASE WHEN r.production_id IS NULL THEN 1 ELSE 0 END,
    COALESCE(p.year,0) DESC,p.id DESC,r.created_at DESC,r.id DESC`;
  const filter = query
    ? " AND (r.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR r.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR r.original_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR p.title LIKE ? ESCAPE '\\' COLLATE NOCASE)"
    : "";
  const params = query ? Array(4).fill(`%${query.replace(/[\\%_]/g, "\\$&")}%`) : [];
  const total =
    (await c.env.DB.prepare(
      `SELECT COUNT(*) n FROM resource r LEFT JOIN production p ON p.id=r.production_id WHERE r.status='approved' AND r.res_type<>'photo' AND ${resourceVisible(c, "r")}` +
        filter,
    )
      .bind(...params)
      .first<number>("n")) || 0;
  const size = 24,
    page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
  const rows = await c.env.DB.prepare(base + filter + order + " LIMIT ? OFFSET ?")
    .bind(...params, size, (page - 1) * size)
    .all<ResourceRow>();
  return c.html(
    resourceListPage(rows.results, c.get("user")!, "", false, query, {
      page,
      total,
      size,
      path: "/resources",
      query,
    }),
  );
});
resourceRoutes.get("/my-resources", async (c) => {
  const u = c.get("user")!;
  const total =
    (await c.env.DB.prepare(`SELECT COUNT(*) n FROM resource WHERE uploader_id=? AND ${resourceVisible(c)}`)
      .bind(u.id)
      .first<number>("n")) || 0;
  const size = 24,
    page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
  const rows = await c.env.DB.prepare(
    `SELECT r.edition_id,(SELECT COALESCE(year,'')||' · '||name FROM production_edition WHERE id=r.edition_id) edition_name,r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.uploader_id=? AND ${resourceVisible(c, "r")} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(u.id, size, (page - 1) * size)
    .all<ResourceRow>();
  return c.html(
    resourceListPage(rows.results, u, await csrfFor(c), true, "", { page, total, size, path: "/my-resources" }),
  );
});
resourceRoutes.get("/resources/submit", async (c) => {
  const u = c.get("user")!;
  const productions = await c.env.DB.prepare(
    `SELECT id,title FROM production WHERE ${productionVisible(c)} ORDER BY year DESC,id DESC`,
  ).all<{
    id: number;
    title: string;
  }>();
  const requestedProductionId = Number(c.req.query("production_id"));
  const selectedProductionId = productions.results.some((production) => production.id === requestedProductionId)
    ? requestedProductionId
    : null;
  return c.html(
    resourceFormPage(
      productions.results,
      await csrfFor(c),
      u.role === "admin",
      selectedProductionId,
      (
        await c.env.DB.prepare(
          `SELECT e.* FROM production_edition e JOIN production p ON p.id=e.production_id WHERE ${productionVisible(c, "p")} ORDER BY e.year DESC,e.id DESC`,
        ).all<EditionRow>()
      ).results,
      Number(c.req.query("edition_id")) || null,
    ),
  );
});
resourceRoutes.post("/resources/submit", async (c) => {
  const u = c.get("user")!;
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  return c.text("请启用浏览器 JavaScript 后使用分片上传。", 400);
});
resourceRoutes.get("/resources/:id", async (c) => {
  const u = c.get("user")!;
  const row = await c.env.DB.prepare(
    `SELECT r.edition_id,(SELECT COALESCE(year,'')||' · '||name FROM production_edition WHERE id=r.edition_id) edition_name,r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.id=? AND ${resourceVisible(c, "r")}`,
  )
    .bind(Number(c.req.param("id")))
    .first<ResourceRow>();
  if (!row) return c.text("资料不存在。", 404);
  if (!canViewResource(row, u)) return c.text("没有权限查看这份资料。", 403);
  const navigation =
    row.res_type === "photo" && row.production_id && row.edition_id
      ? await c.env.DB.prepare(
          `WITH photos AS (
            SELECT id,
              LAG(id) OVER (ORDER BY created_at DESC,id DESC) previous_id,
              LEAD(id) OVER (ORDER BY created_at DESC,id DESC) next_id,
              ROW_NUMBER() OVER (ORDER BY created_at DESC,id DESC) position,
              COUNT(*) OVER () total
            FROM resource
            WHERE production_id=? AND edition_id=? AND status='approved' AND res_type='photo'
          ) SELECT previous_id,next_id,position,total FROM photos WHERE id=?`,
        )
          .bind(row.production_id, row.edition_id, row.id)
          .first<PhotoNavigation>()
      : null;
  const origin = Number(c.req.query("origin"));
  return c.html(
    resourceDetailPage(row, u, navigation, {
      origin: Number.isSafeInteger(origin) && origin > 0 ? origin : row.id,
      page: pageNumber(c.req.query("page")),
    }),
  );
});
for (const mode of ["download", "media", "preview"] as const) {
  resourceRoutes.on(["GET", "HEAD"], "/resources/:id/" + mode, async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT filename,original_name,preview_filename,res_type,status,uploader_id FROM resource WHERE id=? AND ${resourceVisible(c)}`,
    )
      .bind(Number(c.req.param("id")))
      .first<{
        filename: string;
        original_name: string;
        preview_filename: string;
        res_type: string;
        status: string;
        uploader_id: number | null;
      }>();
    if (!row || (mode === "download" && row.status !== "approved")) return c.text("文件不存在或尚未通过审核。", 404);
    if (!canViewResource(row, c.get("user")!)) return c.text("没有权限查看这份资料。", 403);
    const key =
      mode === "preview"
        ? row.preview_filename || (c.get("user") && row.res_type === "photo" ? row.filename : "")
        : row.filename;
    if (!key) return c.text("这份资料还没有缩略图。", 404);
    return serveResourceFile(c.req.raw, c.env.FILES, {
      key,
      filename: mode === "preview" && row.preview_filename ? "preview.jpg" : row.original_name || row.filename,
      download: mode === "download",
      publicImage:
        mode === "preview" && Boolean(row.preview_filename) && row.status === "approved" && row.res_type === "photo",
    });
  });
}
resourceRoutes.get("/admin/resources/reviews", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const filter = adminResourceFilter(c.req.query(), true);
  const total =
    (await c.env.DB.prepare("SELECT COUNT(*) n" + filter.from)
      .bind(...filter.values)
      .first<number>("n")) || 0;
  const page = adminPage(total, c.req.query("page"), "/admin/resources/reviews", filter.params);
  const rows = await c.env.DB.prepare(adminResourceColumns + filter.from + " ORDER BY r.id LIMIT ? OFFSET ?")
    .bind(...filter.values, page.size, (page.page - 1) * page.size)
    .all<ResourceRow>();
  return c.html(resourceReviewsPage(rows.results, await csrfFor(c), page));
});
resourceRoutes.post("/admin/resources/:id/review", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  const decision = f.get("decision") === "approve" ? "approved" : "rejected";
  const note = String(f.get("admin_note") ?? "").trim();
  if (decision === "rejected" && !note) return c.text("驳回时必须填写理由。", 400);
  await reviewRequest(c.env.DB, "resource", Number(c.req.param("id")), c.get("user")!.id, decision, note);
  return c.redirect(safeListReturn(f.get("return_to"), "/admin/resources/reviews"), 303);
});
resourceRoutes.get("/admin/resources", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const filter = adminResourceFilter(c.req.query());
  const total =
    (await c.env.DB.prepare("SELECT COUNT(*) n" + filter.from)
      .bind(...filter.values)
      .first<number>("n")) || 0;
  const page = adminPage(total, c.req.query("page"), "/admin/resources", filter.params);
  const rows = await c.env.DB.prepare(adminResourceColumns + filter.from + " ORDER BY r.id DESC LIMIT ? OFFSET ?")
    .bind(...filter.values, page.size, (page.page - 1) * page.size)
    .all<ResourceRow>();
  return c.html(resourceAdminPage(rows.results, page));
});
resourceRoutes.get("/admin/resources/:id/edit", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const row = await c.env.DB.prepare(
    `SELECT r.edition_id,(SELECT COALESCE(year,'')||' · '||name FROM production_edition WHERE id=r.edition_id) edition_name,r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.id=?`,
  )
    .bind(Number(c.req.param("id")))
    .first<ResourceRow>();
  if (!row) return c.text("资料不存在。", 404);
  const productions = await c.env.DB.prepare("SELECT id,title FROM production ORDER BY year DESC,id DESC").all<{
    id: number;
    title: string;
  }>();
  return c.html(
    resourceEditPage(
      row,
      productions.results,
      await csrfFor(c),
      c.req.query("saved") === "1",
      (await c.env.DB.prepare("SELECT * FROM production_edition ORDER BY year DESC,id DESC").all<EditionRow>()).results,
      safeListReturn(c.req.query("return_to"), "/admin/resources"),
    ),
  );
});
resourceRoutes.post("/admin/resources/:id/edit", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  const title = String(f.get("title") ?? "").trim(),
    type = String(f.get("res_type") ?? "other"),
    description = String(f.get("description") ?? "").trim(),
    productionText = String(f.get("production_id") ?? ""),
    production = productionText ? Number(productionText) : null;
  if (
    !title ||
    title.length > 100 ||
    description.length > 2000 ||
    !["video", "script", "photo", "audio", "other"].includes(type)
  )
    return c.text("请检查资料信息。", 400);
  if (production !== null && !(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(production).first()))
    return c.text("作品不存在。", 400);
  const id = Number(c.req.param("id"));
  const previous = await c.env.DB.prepare("SELECT production_id,edition_id FROM resource WHERE id=?")
    .bind(id)
    .first<{ production_id: number | null; edition_id: number | null }>();
  const editionId = f.has("edition_id")
    ? Number(f.get("edition_id")) || null
    : previous?.production_id === production
      ? previous.edition_id
      : null;
  if (
    editionId &&
    (!production ||
      !(await c.env.DB.prepare("SELECT id FROM production_edition WHERE id=? AND production_id=?")
        .bind(editionId, production)
        .first()))
  )
    return c.text("版本不属于所选作品。", 400);
  const result = await c.env.DB.prepare(
    "UPDATE resource SET title=?,res_type=?,description=?,production_id=?,edition_id=? WHERE id=?",
  )
    .bind(title, type, description, production, editionId, id)
    .run();
  if (result.meta.changes !== 1) return c.text("资料不存在。", 404);
  return c.redirect(
    `/admin/resources/${id}/edit?` +
      new URLSearchParams({ saved: "1", return_to: safeListReturn(f.get("return_to"), "/admin/resources") }),
    303,
  );
});
resourceRoutes.post("/admin/resources/:id/delete", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT filename,preview_filename FROM resource WHERE id=?")
    .bind(id)
    .first<{ filename: string; preview_filename: string }>();
  if (!row) return c.text("资料不存在。", 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE production SET cover_id=NULL WHERE cover_id=?").bind(id),
    c.env.DB.prepare("UPDATE site_profile SET hero_photo='' WHERE hero_photo=?").bind(String(id)),
    c.env.DB.prepare("UPDATE site_profile SET page_background_photo='' WHERE page_background_photo=?").bind(String(id)),
    c.env.DB.prepare("DELETE FROM resource WHERE id=?").bind(id),
    ...fileCleanupStatements(c.env, [row.filename, row.preview_filename]),
  ]);
  await drainFileCleanup(c.env);
  await invalidateSiteProfile(c);
  return c.redirect(safeListReturn(f.get("return_to"), "/admin/resources"), 303);
});

resourceRoutes.post("/admin/resources/:id/revoke", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
  const id = Number(c.req.param("id")),
    note = String(form.get("admin_note") || "管理员撤销公开，重新人工审核")
      .trim()
      .slice(0, 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note) SELECT 'resource',id,?,'rejected',? FROM resource WHERE id=? AND status='approved'",
    ).bind(c.get("user")!.id, note, id),
    c.env.DB.prepare(
      "UPDATE resource SET status='pending',admin_note=?,reviewed_by=NULL,reviewed_at=NULL WHERE id=? AND status='approved'",
    ).bind(note, id),
  ]);
  return c.redirect(
    "/admin/resources/" +
      id +
      "/edit?" +
      new URLSearchParams({ return_to: safeListReturn(form.get("return_to"), "/admin/resources") }),
    303,
  );
});
