import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppEnv } from "../types";
import { SESSION_COOKIE } from "../http/cookies";
import { adminPortal } from "./admin-portal";

export const NAVIGATION_CACHE_SECONDS = 20;
// Browser-only, anonymous landing pages. Cookie/Authorization variants must never mix.
export function publicNavigationRequest(c: Context<AppEnv>): boolean {
  return (
    ["GET", "HEAD"].includes(c.req.method) &&
    ["/", "/productions", "/resources", "/members", "/thanks"].includes(c.req.path) &&
    !new URL(c.req.url).search &&
    !c.get("user") &&
    !getCookie(c, SESSION_COOKIE) &&
    !c.req.header("Authorization") &&
    !adminPortal(c)?.active
  );
}
