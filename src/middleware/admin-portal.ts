import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { adminPortal } from "../services/admin-portal";

export const adminPortalGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const portal = adminPortal(c);
  if (!portal) return next();
  const url = new URL(c.req.url);
  const read = c.req.method === "GET" || c.req.method === "HEAD";
  // Keep old authenticated write requests and notification fetches compatible.
  if (
    url.origin === portal.publicSite &&
    read &&
    /^\/admin(?:\/|$)/.test(url.pathname) &&
    url.pathname !== "/admin/notifications"
  )
    return c.redirect(portal.admin + url.pathname + url.search, 302);
  if (!portal.active) return next();
  c.header("X-Robots-Tag", "noindex, nofollow");
  if (["/login", "/logout", "/site/theme.css", "/health"].includes(url.pathname)) return next();
  if (url.pathname === "/register") return c.redirect("/login", 303);
  const user = c.get("user");
  const notificationRequest = url.pathname.startsWith("/admin/notifications");
  if (!user) {
    if (notificationRequest) return c.json({ error: "登录状态已失效，请重新登录。" }, 401);
    if (!read) return c.text("请先登录管理员账号。", 401);
    return c.redirect("/login?next=" + encodeURIComponent(url.pathname === "/" ? "/admin" : url.pathname + url.search));
  }
  if (user.role !== "admin")
    return notificationRequest
      ? c.json({ error: "此入口仅供管理员使用。" }, 403)
      : c.text("此入口仅供管理员使用，请返回正式网站。", 403);
  if (url.pathname === "/" && read) return c.redirect("/admin", 302);
  await next();
};
