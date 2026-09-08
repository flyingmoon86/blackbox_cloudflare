import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { verifyPassword } from "./auth/password";
import { createSession, newCsrfToken, readSession } from "./auth/session";
import { loginPage, memberHome, publicHome } from "./views";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
};

type UserRow = {
  id: number;
  username: string;
  password_hash: string;
  auth_version: number;
  role: "user" | "member" | "admin";
  status: "active" | "disabled";
};

const app = new Hono<{ Bindings: Bindings }>();
const SESSION_COOKIE = "blackbox_session";
const CSRF_COOKIE = "blackbox_csrf";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
});

function secureCookie(c: { req: { url: string } }): boolean {
  return new URL(c.req.url).protocol === "https:";
}

function cookieOptions(c: { req: { url: string } }, httpOnly: boolean) {
  return { httpOnly, secure: secureCookie(c), sameSite: "Lax" as const, path: "/" };
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

async function csrfFor(c: any): Promise<string> {
  let token = getCookie(c, CSRF_COOKIE);
  if (!token) {
    token = newCsrfToken();
    setCookie(c, CSRF_COOKIE, token, { ...cookieOptions(c, true), maxAge: SESSION_SECONDS });
  }
  return token;
}

function csrfValid(c: any, value: FormDataEntryValue | null): boolean {
  const cookie = getCookie(c, CSRF_COOKIE);
  return typeof value === "string" && Boolean(cookie) && value === cookie;
}

async function currentUser(c: any): Promise<UserRow | null> {
  const session = await readSession(getCookie(c, SESSION_COOKIE), c.env.SESSION_SECRET);
  if (!session) return null;
  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash, auth_version, role, status FROM user WHERE id = ?"
  ).bind(session.uid).first() as UserRow | null;
  if (!user || user.status !== "active" || user.auth_version !== session.version) return null;
  return user;
}

app.get("/health", (c) => c.json({ ok: true, runtime: "typescript-worker" }));

app.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.html(publicHome());
  return c.html(memberHome(user.username, await csrfFor(c), user.role));
});

app.get("/login", async (c) => {
  if (await currentUser(c)) return c.redirect("/");
  return c.html(loginPage(await csrfFor(c), "", safeNext(c.req.query("next") ?? null)));
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash, auth_version, role, status FROM user WHERE username = ? COLLATE NOCASE"
  ).bind(username).first<UserRow>();
  if (!user || user.status !== "active" || !verifyPassword(user.password_hash, password)) {
    return c.html(loginPage(await csrfFor(c), "用户名或密码不正确。", safeNext(form.get("next"))), 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const token = await createSession({ uid: user.id, version: user.auth_version, exp }, c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c, true), maxAge: SESSION_SECONDS });
  return c.redirect(safeNext(form.get("next")), 303);
});

app.post("/logout", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  deleteCookie(c, SESSION_COOKIE, cookieOptions(c, true));
  return c.redirect("/", 303);
});

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((error, c) => {
  console.error(error);
  return c.text("服务暂时不可用，请稍后重试。", 500);
});

export default app;
