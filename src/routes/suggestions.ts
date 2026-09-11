import { consumeAccountLimit } from "../middleware/request-limits";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import { suggestionFormPage, suggestionInboxPage, suggestionPermissionPage } from "../views/suggestions";

export type SuggestionRow = {
  id: number;
  username: string;
  content: string;
  status: "open" | "resolved";
  admin_note: string;
  created_at: string;
  category: "website" | "production";
  production_title: string | null;
  production_year: number | null;
};

export const suggestionRoutes = new Hono<AppEnv>();

suggestionRoutes.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/suggestions") && !c.req.path.startsWith("/admin/suggestions")) return next();
  if (!c.get("user")) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

suggestionRoutes.get("/suggestions", async (c) => {
  const user = c.get("user")!;
  if (user.role === "user") return c.html(suggestionPermissionPage(false), 403);
  const category = c.req.query("type") === "production" ? "production" : "website";
  const source = c.req.query("source") === "productions" ? "productions" : "upload";
  return c.html(
    suggestionFormPage(await csrfFor(c), c.req.query("sent") === "1", user.role === "admin", category, source),
  );
});

suggestionRoutes.post("/suggestions", async (c) => {
  const user = c.get("user")!;
  if (user.role === "user") return c.html(suggestionPermissionPage(false), 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const category = form.get("category") === "production" ? "production" : "website";
  const source = form.get("source") === "productions" ? "productions" : "upload";
  const content = String(form.get("content") ?? "").trim();
  const productionTitle = String(form.get("production_title") ?? "").trim();
  const productionYearText = String(form.get("production_year") ?? "").trim();
  const productionYear = productionYearText ? Number(productionYearText) : null;
  if (content.length > 3000) return c.text("补充说明不能超过 3000 字。", 400);
  if (category === "website" && !content) return c.text("请填写 1–3000 字的建议。", 400);
  if (
    category === "production" &&
    (!productionTitle ||
      productionTitle.length > 100 ||
      (productionYear !== null && (!Number.isInteger(productionYear) || productionYear < 1 || productionYear > 9999)))
  )
    return c.text("请填写作品名称，并检查演出年份。", 400);
  const retry = await consumeAccountLimit(c, "suggestion-" + category, 12);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("提交次数较多，请稍后重试。", 429);
  }
  await c.env.DB.prepare(
    "INSERT INTO suggestion(user_id,content,category,production_title,production_year) VALUES(?,?,?,?,?)",
  )
    .bind(user.id, content || "请管理员新建这部作品的档案。", category, productionTitle || null, productionYear)
    .run();
  return c.redirect(`/suggestions?type=${category}&source=${source}&sent=1`, 303);
});

suggestionRoutes.get("/admin/suggestions", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
  const rows = await c.env.DB.prepare(
    `SELECT s.id,u.username,s.content,s.status,s.admin_note,s.created_at,s.category,s.production_title,s.production_year FROM suggestion s
     JOIN user u ON u.id=s.user_id ORDER BY CASE s.status WHEN 'open' THEN 0 ELSE 1 END,s.created_at DESC`,
  ).all<SuggestionRow>();
  return c.html(suggestionInboxPage(rows.results, await csrfFor(c)));
});

suggestionRoutes.post("/admin/suggestions/:id/resolve", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const note = String(form.get("admin_note") ?? "")
    .trim()
    .slice(0, 1000);
  const result = await c.env.DB.prepare(
    "UPDATE suggestion SET status='resolved',admin_note=?,resolved_at=CURRENT_TIMESTAMP WHERE id=?",
  )
    .bind(note, Number(c.req.param("id")))
    .run();
  if (result.meta.changes !== 1) return c.text("建议不存在。", 404);
  return c.redirect("/admin/suggestions", 303);
});
