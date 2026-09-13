import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { readSession } from "../auth/session";
import { SESSION_COOKIE } from "../http/cookies";
import type { AppEnv, UserSession } from "../types";

export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", null);
  const session = await readSession(getCookie(c, SESSION_COOKIE), c.env.SESSION_SECRET);
  if (session) {
    const user = (await c.env.DB.prepare(
      "SELECT id, username, auth_version, role, status, email, pending_email, member_id, must_change_password FROM user WHERE id = ?",
    )
      .bind(session.uid)
      .first()) as UserSession | null;
    if (user?.status === "active" && user.auth_version === session.version) c.set("user", user);
  }
  if (
    c.get("user")?.must_change_password &&
    !["/profile", "/profile/password", "/logout", "/site/theme.css"].includes(c.req.path)
  ) {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") return c.text("请先修改临时密码。", 403);
    return c.redirect("/profile", 303);
  }
  await next();
};
