import { serveResourceFile } from "../services/resource-files";
import { getSiteProfile } from "../services/site-profile";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { theatreHome } from "../views/home";
import type { AnnouncementRow } from "./content";
import type { ProductionRow } from "./productions";
type Photo = { id: number; filename: string; original_name: string; preview_filename: string };
export async function selectHero(c: Context<AppEnv>): Promise<Photo | null> {
  return c.env.DB.prepare(
    "SELECT r.id,r.filename,r.original_name,r.preview_filename FROM resource r CROSS JOIN site_profile s LEFT JOIN production p ON p.id=s.featured_production_id WHERE s.id=1 AND r.status='approved' AND r.res_type='photo' AND r.preview_filename IS NOT NULL AND r.preview_filename<>'' ORDER BY CASE WHEN CAST(r.id AS TEXT)=s.hero_photo THEN 0 WHEN r.id=p.cover_id THEN 1 ELSE 2 END,r.created_at DESC,r.id DESC LIMIT 1",
  ).first<Photo>();
}
export async function homePage(c: Context<AppEnv>) {
  const [profile, announcements, hero, latest] = await Promise.all([
    getSiteProfile(c),
    c.env.DB.prepare(
      "SELECT id,title,content,created_at FROM announcement ORDER BY created_at DESC,id DESC LIMIT 1",
    ).all<AnnouncementRow>(),
    selectHero(c),
    c.env.DB.prepare(
      "SELECT id,title,promo,synopsis,year,cover_id FROM production ORDER BY year DESC,id DESC LIMIT 4",
    ).all<ProductionRow>(),
  ]);
  if (!profile) return c.text("剧团信息暂不可用，请稍后重试。", 503);
  const featured = profile.featured_production_id
    ? await c.env.DB.prepare(
        "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production WHERE id=?",
      )
        .bind(profile.featured_production_id)
        .first<ProductionRow>()
    : null;
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(profile.page_texts || "{}");
  } catch {}
  await Promise.all(
    ["recruitment_poster", "recruitment_poster_mobile"].map(async (key) => {
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
    }),
  );
  profile.page_texts = JSON.stringify(texts);
  const news = announcements.results[0];
  const revision = news
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(JSON.stringify([news.id, news.title, news.content, news.created_at])),
          ),
        ),
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
    : "";
  return c.html(
    theatreHome(profile, featured, announcements.results, c.get("user"), hero?.id ?? null, latest.results, revision),
  );
}
async function photoResponse(c: Context<AppEnv>, photo: Photo | null) {
  if (!photo?.filename) return c.text("展示图正在准备。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: photo.filename,
    filename: photo.original_name || photo.filename,
    publicImage: true,
  });
}
export async function heroImage(c: Context<AppEnv>) {
  return photoResponse(c, await selectHero(c));
}
export async function pageBackgroundImage(c: Context<AppEnv>) {
  const section = c.req.query("section") || "";
  const keys: Record<string, string> = {
    productions: "productions_background",
    members: "members_background",
    thanks: "thanks_background",
  };
  if (!keys[section]) return c.body(null, 204);
  const profile = await getSiteProfile(c);
  let id = 0;
  try {
    id = Number(JSON.parse(profile?.page_texts || "{}")[keys[section]]);
  } catch {}
  if (!Number.isSafeInteger(id) || id <= 0) return c.body(null, 204);
  const photo = await c.env.DB.prepare(
    "SELECT id,filename,original_name,preview_filename FROM resource WHERE id=? AND status='approved' AND res_type='photo' AND preview_filename IS NOT NULL AND preview_filename<>''",
  )
    .bind(id)
    .first<Photo>();
  if (!photo) return c.body(null, 204);
  return photoResponse(c, photo);
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
  const profile = await getSiteProfile(c);
  let id = 0;
  try {
    id = Number(JSON.parse(profile?.page_texts || "{}").mascot_photo);
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

export async function recruitmentPosterImage(c: Context<AppEnv>) {
  const profile = await getSiteProfile(c);
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(profile?.page_texts || "{}");
  } catch {}
  const candidates =
    c.req.query("variant") === "mobile"
      ? [texts.recruitment_poster_mobile, texts.recruitment_poster]
      : [texts.recruitment_poster, texts.recruitment_poster_mobile];
  for (const value of candidates) {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const photo = await c.env.DB.prepare(
      "SELECT id,filename,original_name,preview_filename FROM resource WHERE id=? AND status='approved' AND res_type='photo'",
    )
      .bind(id)
      .first<Photo>();
    if (photo) return photoResponse(c, photo);
  }
  return c.notFound();
}
