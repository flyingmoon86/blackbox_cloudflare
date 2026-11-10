import type { Context } from "hono";
import type { AppEnv } from "../types";

export function adminOnly(c: Context<AppEnv>): Response | null {
  return c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403);
}
