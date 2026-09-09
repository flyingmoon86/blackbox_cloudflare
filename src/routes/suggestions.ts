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
  return c.html(suggestionFormPage(await csrfFor(c), c.req.query("sent") === "1", user.role === "admin"));
});

suggestionRoutes.post("/suggestions", async (c) => {
  const user = c.get("user")!;
  if (user.role === "user") return c.html(suggestionPermissionPage(false), 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const content = String(form.get("content") ?? "").trim();
  if (!content || content.length > 3000) return c.text("请填写 1–3000 字的建议。", 400);
  await c.env.DB.prepare("INSERT INTO suggestion(user_id,content) VALUES(?,?)").bind(user.id, content).run();
  return c.redirect("/suggestions?sent=1", 303);
});

suggestionRoutes.get("/admin/suggestions", async (c) => {
  if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
  const rows = await c.env.DB.prepare(
    `SELECT s.id,u.username,s.content,s.status,s.admin_note,s.created_at FROM suggestion s
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
