import { reviewRequest } from "../services/reviews";
import { canViewResource, serveResourceFile } from "../services/resource-files";
import { fileCleanupStatements, drainFileCleanup } from "../services/file-cleanup";
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
export const resourceRoutes = new Hono<AppEnv>();
resourceRoutes.use("*", async (c, next) => {
  if (
    !c.req.path.startsWith("/resources") &&
    c.req.path !== "/my-resources" &&
    !c.req.path.startsWith("/admin/resources")
  )
    return next();
  if (!c.get("user")) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});
const adminDenied = (c: any) => (c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403));

resourceRoutes.get("/resources", async (c) => {
  const query = (c.req.query("q") || "").trim().slice(0, 100);
  const base = `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name
    FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id
    WHERE r.status='approved'`;
  const order = ` ORDER BY CASE WHEN r.production_id IS NULL THEN 1 ELSE 0 END,
    COALESCE(p.year,0) DESC,p.id DESC,r.created_at DESC,r.id DESC`;
  const rows = query
    ? await c.env.DB.prepare(
        `${base} AND (r.title LIKE ? ESCAPE '\\' COLLATE NOCASE OR r.description LIKE ? ESCAPE '\\' COLLATE NOCASE
          OR r.original_name LIKE ? ESCAPE '\\' COLLATE NOCASE OR p.title LIKE ? ESCAPE '\\' COLLATE NOCASE)${order}`,
      )
        .bind(...Array(4).fill(`%${query.replace(/[\\%_]/g, "\\$&")}%`))
        .all<ResourceRow>()
    : await c.env.DB.prepare(`${base}${order}`).all<ResourceRow>();
  return c.html(resourceListPage(rows.results, c.get("user")!, await csrfFor(c), false, query));
});
resourceRoutes.get("/my-resources", async (c) => {
  const u = c.get("user")!;
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.uploader_id=? ORDER BY r.id DESC`,
  )
    .bind(u.id)
    .all<ResourceRow>();
  return c.html(resourceListPage(rows.results, u, await csrfFor(c), true));
});
resourceRoutes.get("/resources/submit", async (c) => {
  const u = c.get("user")!;
  if (u.role === "user") return c.html(resourcePermissionPage(), 403);
  const productions = await c.env.DB.prepare("SELECT id,title FROM production ORDER BY year DESC,id DESC").all<{
    id: number;
    title: string;
  }>();
  const requestedProductionId = Number(c.req.query("production_id"));
  const selectedProductionId = productions.results.some((production) => production.id === requestedProductionId)
    ? requestedProductionId
    : null;
  return c.html(resourceFormPage(productions.results, await csrfFor(c), u.role === "admin", selectedProductionId));
});
resourceRoutes.post("/resources/submit", async (c) => {
  const u = c.get("user")!;
  if (u.role === "user") return c.text("认证队员或管理员才能提交资料。", 403);
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  return c.text("请启用浏览器 JavaScript 后使用分片上传。", 400);
});
resourceRoutes.get("/resources/:id", async (c) => {
  const u = c.get("user")!;
  const row = await c.env.DB.prepare(
    `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.id=?`,
  )
    .bind(Number(c.req.param("id")))
    .first<ResourceRow>();
  if (!row) return c.text("资料不存在。", 404);
  if (!canViewResource(row, u)) return c.text("没有权限查看这份资料。", 403);
  return c.html(resourceDetailPage(row, u));
});
for (const mode of ["download", "media", "preview"] as const) {
  resourceRoutes.on(["GET", "HEAD"], "/resources/:id/" + mode, async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT filename,original_name,preview_filename,res_type,status,uploader_id FROM resource WHERE id=?",
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
      mode === "preview" ? row.preview_filename || (row.res_type === "photo" ? row.filename : "") : row.filename;
    if (!key) return c.text("这份资料还没有缩略图。", 404);
    return serveResourceFile(c.req.raw, c.env.FILES, {
      key,
      filename: mode === "preview" && row.preview_filename ? "preview.jpg" : row.original_name || row.filename,
      download: mode === "download",
    });
  });
}
resourceRoutes.get("/admin/resources/reviews", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.status='pending' ORDER BY r.id`,
  ).all<ResourceRow>();
  return c.html(resourceReviewsPage(rows.results, await csrfFor(c)));
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
  return c.redirect("/admin/resources/reviews", 303);
});
resourceRoutes.get("/admin/resources", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id ORDER BY r.id DESC LIMIT 300`,
  ).all<ResourceRow>();
  return c.html(resourceAdminPage(rows.results));
});
resourceRoutes.get("/admin/resources/:id/edit", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const row = await c.env.DB.prepare(
    `SELECT r.id,r.title,r.res_type,r.description,r.original_name,r.preview_filename,r.status,r.admin_note,r.created_at,r.production_id,p.title production_title,r.uploader_id,u.username uploader_name FROM resource r LEFT JOIN production p ON p.id=r.production_id LEFT JOIN user u ON u.id=r.uploader_id WHERE r.id=?`,
  )
    .bind(Number(c.req.param("id")))
    .first<ResourceRow>();
  if (!row) return c.text("资料不存在。", 404);
  const productions = await c.env.DB.prepare("SELECT id,title FROM production ORDER BY year DESC,id DESC").all<{
    id: number;
    title: string;
  }>();
  return c.html(resourceEditPage(row, productions.results, await csrfFor(c), c.req.query("saved") === "1"));
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
  const result = await c.env.DB.prepare(
    "UPDATE resource SET title=?,res_type=?,description=?,production_id=? WHERE id=?",
  )
    .bind(title, type, description, production, id)
    .run();
  if (result.meta.changes !== 1) return c.text("资料不存在。", 404);
  return c.redirect(`/admin/resources/${id}/edit?saved=1`, 303);
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
  return c.redirect("/admin/resources", 303);
});
