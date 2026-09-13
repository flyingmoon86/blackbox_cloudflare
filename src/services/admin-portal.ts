import type { Context } from "hono";
import type { AppEnv } from "../types";

export function adminPortal(c: Context<AppEnv>) {
  const admin = c.env.ADMIN_ORIGIN;
  const publicSite = c.env.PUBLIC_ORIGIN;
  if (!admin || !publicSite) return null;
  // Only operator-configured origins are used; never trust forwarding headers.
  const a = new URL(admin),
    p = new URL(publicSite);
  if (
    a.origin === p.origin ||
    a.origin !== admin ||
    p.origin !== publicSite ||
    !["https:", "http:"].includes(a.protocol) ||
    !["https:", "http:"].includes(p.protocol) ||
    (c.env.ENVIRONMENT === "production" && (a.protocol !== "https:" || p.protocol !== "https:"))
  )
    throw new Error("Invalid portal origins");
  return { admin, publicSite, active: new URL(c.req.url).origin === admin };
}
