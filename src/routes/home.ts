import { serveResourceFile } from "../services/resource-files";
import type { Context } from "hono";
import { csrfFor } from "../http/cookies";
import type { AppEnv } from "../types";
import { memberHome, publicHome } from "../views";
import type { AnnouncementRow, SiteProfileRow } from "./content";
import type { ProductionRow } from "./productions";

export async function homePage(c: Context<AppEnv>) {
  const user = c.get("user");
  const profile = await c.env.DB.prepare(
    "SELECT troupe_name,introduction,contact_email,contact_wechat,qq_group,public_account,recruitment,requirements,hero_photo,page_background_photo,featured_production_id,page_texts FROM site_profile WHERE id=1",
  ).first<SiteProfileRow>();
  const featured = profile?.featured_production_id
    ? await c.env.DB.prepare(
        "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production WHERE id=?",
      )
        .bind(profile.featured_production_id)
        .first<ProductionRow>()
    : null;
  if (!user) return c.html(publicHome(profile!, featured));
  const announcements = await c.env.DB.prepare(
    "SELECT id,title,content,created_at FROM announcement ORDER BY created_at DESC,id DESC LIMIT 3",
  ).all<AnnouncementRow>();
  return c.html(memberHome(user, await csrfFor(c), profile!, featured, announcements.results));
}

export async function heroImage(c: Context<AppEnv>) {
  const profile = await c.env.DB.prepare("SELECT hero_photo FROM site_profile WHERE id=1").first<{
    hero_photo: string;
  }>();
  const id = Number(profile?.hero_photo);
  if (!Number.isInteger(id) || id < 1) return c.text("首页背景不存在。", 404);
  const row = await c.env.DB.prepare(
    "SELECT filename,original_name FROM resource WHERE id=? AND status='approved' AND res_type='photo'",
  )
    .bind(id)
    .first<{ filename: string; original_name: string }>();
  if (!row) return c.text("首页背景不存在。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: row.filename,
    filename: row.original_name || row.filename,
    publicImage: true,
  });
}

export async function pageBackgroundImage(c: Context<AppEnv>) {
  const profile = await c.env.DB.prepare("SELECT page_background_photo FROM site_profile WHERE id=1").first<{
    page_background_photo: string;
  }>();
  const id = Number(profile?.page_background_photo);
  if (!Number.isInteger(id) || id < 1) return c.text("全站背景不存在。", 404);
  const row = await c.env.DB.prepare(
    "SELECT filename,original_name FROM resource WHERE id=? AND status='approved' AND res_type='photo'",
  )
    .bind(id)
    .first<{ filename: string; original_name: string }>();
  if (!row) return c.text("全站背景不存在。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: row.filename,
    filename: row.original_name || row.filename,
    publicImage: true,
  });
}

export async function featuredCoverImage(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare(
    `SELECT r.filename,r.original_name FROM site_profile s JOIN production p ON p.id=s.featured_production_id JOIN resource r ON r.id=p.cover_id WHERE s.id=1 AND r.status='approved' AND r.res_type='photo'`,
  ).first<{ filename: string; original_name: string }>();
  if (!row) return c.text("精选作品展示图不存在。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: row.filename,
    filename: row.original_name || row.filename,
    publicImage: true,
  });
}

export function health(c: Context<AppEnv>) {
  return c.json({ ok: true, runtime: "typescript-worker" });
}
