import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, newCsrfToken } from "../auth/session";
import type { AppEnv, UserSession } from "../types";

export const SESSION_COOKIE = "blackbox_session";
const CSRF_COOKIE = "blackbox_csrf";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function options(c: Context<AppEnv>, httpOnly: boolean) {
  return {
    httpOnly,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    path: "/",
  };
}

export async function csrfFor(c: Context<AppEnv>): Promise<string> {
  let token = getCookie(c, CSRF_COOKIE);
  if (!token) {
    token = newCsrfToken();
    setCookie(c, CSRF_COOKIE, token, { ...options(c, true), maxAge: SESSION_SECONDS });
  }
  return token;
}

export function csrfValid(c: Context<AppEnv>, value: FormDataEntryValue | null): boolean {
  const cookie = getCookie(c, CSRF_COOKIE);
  return typeof value === "string" && Boolean(cookie) && value === cookie;
}

export async function startSession(c: Context<AppEnv>, user: UserSession): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = await createSession({ uid: user.id, version: user.auth_version, exp }, c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, { ...options(c, true), maxAge: SESSION_SECONDS });
}

export function clearSession(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, options(c, true));
}
