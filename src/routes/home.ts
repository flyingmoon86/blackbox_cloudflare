import { serveResourceFile } from "../services/resource-files";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { theatreHome } from "../views/home";
import type { AnnouncementRow, SiteProfileRow } from "./content";
import type { ProductionRow } from "./productions";
type Photo = { id: number; filename: string; original_name: string; preview_filename: string };
export async function selectHero(c: Context<AppEnv>): Promise<Photo | null> {
  return c.env.DB.prepare(
    "SELECT r.id,r.filename,r.original_name,r.preview_filename FROM resource r CROSS JOIN site_profile s LEFT JOIN production p ON p.id=s.featured_production_id WHERE s.id=1 AND r.status='approved' AND r.res_type='photo' ORDER BY CASE WHEN CAST(r.id AS TEXT)=s.hero_photo THEN 0 WHEN r.id=p.cover_id THEN 1 ELSE 2 END,r.created_at DESC,r.id DESC LIMIT 1",
  ).first<Photo>();
}
export async function homePage(c: Context<AppEnv>) {
  const profile = await c.env.DB.prepare("SELECT * FROM site_profile WHERE id=1").first<SiteProfileRow>();
  if (!profile) return c.text("剧团信息暂不可用，请稍后重试。", 503);
  const featured = profile.featured_production_id
    ? await c.env.DB.prepare(
        "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production WHERE id=?",
      )
        .bind(profile.featured_production_id)
        .first<ProductionRow>()
    : null;
  const announcements = await c.env.DB.prepare(
    "SELECT id,title,content,created_at FROM announcement ORDER BY created_at DESC,id DESC LIMIT 1",
  ).all<AnnouncementRow>();
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(profile.page_texts || "{}");
  } catch {}
  for (const key of ["recruitment_poster", "recruitment_poster_mobile"]) {
    const id = Number(texts[key]);
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !(await c.env.DB.prepare(
        "SELECT id FROM resource WHERE id=? AND status='approved' AND res_type='photo' AND preview_filename IS NOT NULL AND preview_filename<>''",
      )
        .bind(id)
        .first())
    )
      texts[key] = "";
  }
  profile.page_texts = JSON.stringify(texts);
  const hero = await selectHero(c);
  return c.html(theatreHome(profile, featured, announcements.results, c.get("user"), hero?.id ?? null));
}
async function photoResponse(c: Context<AppEnv>, photo: Photo | null) {
  if (!photo?.preview_filename) return c.text("展示图正在准备。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: photo.preview_filename,
    filename: "preview.jpg",
    publicImage: true,
  });
}
export async function heroImage(c: Context<AppEnv>) {
  return photoResponse(c, await selectHero(c));
}
export async function pageBackgroundImage(c: Context<AppEnv>) {
  return photoResponse(
    c,
    await c.env.DB.prepare(
      "SELECT r.id,r.filename,r.original_name,r.preview_filename FROM resource r JOIN site_profile s ON CAST(r.id AS TEXT)=s.page_background_photo WHERE s.id=1 AND r.status='approved' AND r.res_type='photo'",
    ).first<Photo>(),
  );
}
export async function featuredCoverImage(c: Context<AppEnv>) {
  return photoResponse(
    c,
    await c.env.DB.prepare(
      "SELECT r.id,r.filename,r.original_name,r.preview_filename FROM site_profile s JOIN production p ON p.id=s.featured_production_id JOIN resource r ON r.id=p.cover_id WHERE s.id=1 AND r.status='approved' AND r.res_type='photo'",
    ).first<Photo>(),
  );
}
export async function mascotImage(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare("SELECT page_texts FROM site_profile WHERE id=1").first<{ page_texts: string }>();
  let id = 0;
  try {
    id = Number(JSON.parse(row?.page_texts || "{}").mascot_photo);
  } catch {}
  return photoResponse(
    c,
    Number.isSafeInteger(id) && id > 0
      ? await c.env.DB.prepare(
          "SELECT id,filename,original_name,preview_filename FROM resource WHERE id=? AND status='approved' AND res_type='photo'",
        )
          .bind(id)
          .first<Photo>()
      : null,
  );
}
export function health(c: Context<AppEnv>) {
  return c.json({ ok: true, runtime: "typescript-worker" });
}
