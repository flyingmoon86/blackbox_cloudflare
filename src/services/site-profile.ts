import type { Context } from "hono";
import type { AppEnv } from "../types";
import type { SiteProfileRow } from "../routes/content";
import { cacheOrigin, invalidateCached, readCachedJson, writeCachedJson } from "./edge-cache";

/** Single read-only settings row; short TTL keeps admin saves close to immediate. */
const PROFILE_PARTS = ["site-profile", "v1"] as const;
const PROFILE_TTL_SECONDS = 30;

export async function getSiteProfile(c: Context<AppEnv>): Promise<SiteProfileRow | null> {
  const origin = cacheOrigin(c.env, c.req.raw);
  const cached = await readCachedJson<SiteProfileRow>(origin, PROFILE_PARTS);
  if (cached) return cached;
  const row = await c.env.DB.prepare("SELECT * FROM site_profile WHERE id=1").first<SiteProfileRow>();
  if (row) await writeCachedJson(origin, PROFILE_PARTS, row, PROFILE_TTL_SECONDS);
  return row ?? null;
}

export async function invalidateSiteProfile(c: Context<AppEnv>): Promise<void> {
  await invalidateCached(cacheOrigin(c.env, c.req.raw), PROFILE_PARTS);
}
