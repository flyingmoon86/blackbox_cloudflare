import type { Context } from "hono";
import type { AppEnv } from "../types";

/** SQL fragments accept only developer-owned identifiers, never request input. */
export function productionVisible(c: Context<AppEnv>, alias = "production"): string {
  return c.get("user")?.role === "admin" ? "1=1" : `${alias}.is_hidden=0`;
}

/** Unassigned resources remain accessible under their own approval rules. */
export function resourceVisible(c: Context<AppEnv>, alias = "resource"): string {
  return c.get("user")?.role === "admin"
    ? "1=1"
    : `(${alias}.production_id IS NULL OR EXISTS(SELECT 1 FROM production visibility_parent WHERE visibility_parent.id=${alias}.production_id AND visibility_parent.is_hidden=0))`;
}

export async function canAccessProduction(c: Context<AppEnv>, id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return Boolean(
    await c.env.DB.prepare(`SELECT id FROM production WHERE id=? AND ${productionVisible(c)}`)
      .bind(id)
      .first(),
  );
}
