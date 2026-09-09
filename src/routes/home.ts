import { Hono } from "hono";
import { csrfFor } from "../http/cookies";
import type { AppEnv } from "../types";
import { memberHome, publicHome } from "../views";
import type { AnnouncementRow, SiteProfileRow } from "./content";
import type { ProductionRow } from "./productions";

export const homeRoutes = new Hono<AppEnv>();

homeRoutes.get("/", async (c) => {
  const user = c.get("user");
  const profile=await c.env.DB.prepare("SELECT troupe_name,introduction,contact_email,contact_wechat,qq_group,public_account,recruitment,requirements,featured_production_id,page_texts FROM site_profile WHERE id=1").first<SiteProfileRow>();
  const featured=profile?.featured_production_id?await c.env.DB.prepare("SELECT id,title,synopsis,promo,year,cover_ratio,feature_layout FROM production WHERE id=?").bind(profile.featured_production_id).first<ProductionRow>():null;
  if(!user)return c.html(publicHome(profile!,featured));
  const announcements=await c.env.DB.prepare("SELECT id,title,content,created_at FROM announcement ORDER BY created_at DESC,id DESC LIMIT 3").all<AnnouncementRow>();
  return c.html(memberHome(user,await csrfFor(c),profile!,featured,announcements.results));
});

homeRoutes.get("/health", (c) => c.json({ ok: true, runtime: "typescript-worker" }));
