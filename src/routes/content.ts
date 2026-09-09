import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import { announcementDetailPage, announcementFormPage, announcementListPage, siteSettingsPage } from "../views/content";

export type AnnouncementRow = { id: number; title: string; content: string; created_at: string };
export type SiteProfileRow = {
  troupe_name: string;
  introduction: string | null;
  contact_email: string | null;
  contact_wechat: string | null;
  qq_group: string;
  public_account: string;
  recruitment: string;
  requirements: string;
  hero_photo: string;
  featured_production_id: number | null;
  page_texts: string;
};

export const contentRoutes = new Hono<AppEnv>();

contentRoutes.use("*", async (c, next) => {
  if (
    !c.req.path.startsWith("/announcements") &&
    !c.req.path.startsWith("/admin/announcements") &&
    c.req.path !== "/admin/site"
  )
    return next();
  if (!c.get("user")) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

const adminDenied = (c: any) => (c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403));

contentRoutes.get("/announcements", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id,title,content,created_at FROM announcement ORDER BY created_at DESC,id DESC",
  ).all<AnnouncementRow>();
  return c.html(announcementListPage(result.results, c.get("user")!.role === "admin", await csrfFor(c)));
});

contentRoutes.get("/announcements/:id", async (c) => {
  const item = await c.env.DB.prepare("SELECT id,title,content,created_at FROM announcement WHERE id=?")
    .bind(Number(c.req.param("id")))
    .first<AnnouncementRow>();
  return item
    ? c.html(announcementDetailPage(item, c.get("user")!.role === "admin", await csrfFor(c)))
    : c.text("公告不存在。", 404);
});

contentRoutes.get("/admin/announcements/new", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  return c.html(announcementFormPage(await csrfFor(c)));
});

contentRoutes.post("/admin/announcements/new", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const title = String(form.get("title") ?? "").trim();
  const content = String(form.get("content") ?? "").trim();
  if (!title || title.length > 100) return c.text("公告标题需为 1–100 个字符。", 400);
  const result = await c.env.DB.prepare("INSERT INTO announcement(title,content) VALUES(?,?)")
    .bind(title, content)
    .run();
  return c.redirect(`/announcements/${result.meta.last_row_id}`, 303);
});

contentRoutes.post("/admin/announcements/:id/delete", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  await c.env.DB.prepare("DELETE FROM announcement WHERE id=?")
    .bind(Number(c.req.param("id")))
    .run();
  return c.redirect("/announcements", 303);
});

contentRoutes.get("/admin/site", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const profile = await c.env.DB.prepare(
    "SELECT troupe_name,introduction,contact_email,contact_wechat,qq_group,public_account,recruitment,requirements,hero_photo,featured_production_id,page_texts FROM site_profile WHERE id=1",
  ).first<SiteProfileRow>();
  const productions = await c.env.DB.prepare("SELECT id,title,year FROM production ORDER BY year DESC,id DESC").all<{
    id: number;
    title: string;
    year: number | null;
  }>();
  const photos = await c.env.DB.prepare(
    "SELECT id,title FROM resource WHERE status='approved' AND res_type='photo' ORDER BY id DESC LIMIT 300",
  ).all<{ id: number; title: string }>();
  return c.html(
    siteSettingsPage(profile!, productions.results, photos.results, await csrfFor(c), c.req.query("saved") === "1"),
  );
});

contentRoutes.post("/admin/site", async (c) => {
  const denied = adminDenied(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const current = await c.env.DB.prepare("SELECT page_texts FROM site_profile WHERE id=1").first<{
    page_texts: string;
  }>();
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(current?.page_texts || "{}");
  } catch {}
  for (const key of [
    "home_welcome",
    "visitor_welcome",
    "test_notice",
    "about_text",
    "contact_intro",
    "member_guide",
    "admin_guide",
  ])
    texts[key] = String(form.get(key) ?? "")
      .trim()
      .slice(0, 10000);
  const featuredText = String(form.get("featured_production_id") ?? "");
  const featured = featuredText ? Number(featuredText) : null;
  if (featured !== null && !(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(featured).first()))
    return c.text("请选择有效的精选作品。", 400);
  const heroText = String(form.get("hero_photo") ?? "");
  const hero = heroText ? Number(heroText) : null;
  if (
    hero !== null &&
    !(await c.env.DB.prepare("SELECT id FROM resource WHERE id=? AND status='approved' AND res_type='photo'")
      .bind(hero)
      .first())
  )
    return c.text("首页背景必须选择已审核的剧照。", 400);
  await c.env.DB.prepare(
    `UPDATE site_profile SET troupe_name=?,introduction=?,contact_email=?,contact_wechat=?,qq_group=?,public_account=?,recruitment=?,requirements=?,hero_photo=?,featured_production_id=?,page_texts=? WHERE id=1`,
  )
    .bind(
      String(form.get("troupe_name") ?? "")
        .trim()
        .slice(0, 100) || "话剧队",
      String(form.get("introduction") ?? "").trim() || null,
      String(form.get("contact_email") ?? "").trim() || null,
      String(form.get("contact_wechat") ?? "").trim() || null,
      String(form.get("qq_group") ?? "")
        .trim()
        .slice(0, 50),
      String(form.get("public_account") ?? "")
        .trim()
        .slice(0, 100),
      String(form.get("recruitment") ?? "").trim(),
      String(form.get("requirements") ?? "").trim(),
      hero === null ? "" : String(hero),
      featured,
      JSON.stringify(texts),
    )
    .run();
  return c.redirect("/admin/site?saved=1", 303);
});
