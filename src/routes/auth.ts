import { Hono } from "hono";
import { clearSession, csrfFor, csrfValid, startSession } from "../http/cookies";
import { hashPassword, verifyPassword } from "../auth/password";
import type { AccountRow, AppEnv } from "../types";
import { loginPage, profilePage, registerDonePage, registerPage } from "../views";

export const authRoutes = new Hono<AppEnv>();

function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email) return "";
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) return null;
  return email;
}

function validPassword(password: string, confirmation: string): boolean {
  return password.length >= 8 && password.length <= 128 && password === confirmation;
}

authRoutes.get("/login", async (c) => {
  if (c.get("user")) return c.redirect("/");
  const info = c.req.query("password_changed") === "1" ? "密码已修改，请使用新密码登录。" : "";
  return c.html(loginPage(await csrfFor(c), "", safeNext(c.req.query("next") ?? null), info));
});

authRoutes.post("/login", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const user = await c.env.DB.prepare(
    "SELECT id, username, password_hash, auth_version, role, status, email, pending_email FROM user WHERE username = ? COLLATE NOCASE"
  ).bind(username).first() as AccountRow | null;
  if (!user || user.status !== "active" || !verifyPassword(user.password_hash, password)) {
    return c.html(loginPage(await csrfFor(c), "用户名或密码不正确。", safeNext(form.get("next"))), 401);
  }
  await startSession(c, user);
  return c.redirect(safeNext(form.get("next")), 303);
});

authRoutes.post("/logout", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  clearSession(c);
  return c.redirect("/", 303);
});

authRoutes.get("/register", async (c) => {
  if (c.get("user")) return c.redirect("/");
  return c.html(registerPage(await csrfFor(c)));
});

authRoutes.post("/register", async (c) => {
  if (c.get("user")) return c.redirect("/");
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("confirm_password") ?? "");
  const email = normalizeEmail(String(form.get("email") ?? ""));
  const values = { username, email: String(form.get("email") ?? "") };
  if (!username || username.length > 50) return c.html(registerPage(await csrfFor(c), "用户名需为 1–50 个字符。", values), 400);
  if (!validPassword(password, confirmation)) return c.html(registerPage(await csrfFor(c), "密码需为 8–128 位，且两次输入一致。", values), 400);
  if (email === null) return c.html(registerPage(await csrfFor(c), "请填写有效的邮箱地址。", values), 400);
  const exists = await c.env.DB.prepare("SELECT id FROM user WHERE username = ? COLLATE NOCASE").bind(username).first();
  if (exists) return c.html(registerPage(await csrfFor(c), "这个用户名已被使用。", values), 409);
  try {
    await c.env.DB.prepare(
      "INSERT INTO user (username, password_hash, pending_email, role, status) VALUES (?, ?, ?, 'user', 'active')"
    ).bind(username, hashPassword(password), email || null).run();
  } catch {
    return c.html(registerPage(await csrfFor(c), "用户名或邮箱暂时无法使用，请检查后重试。", values), 409);
  }
  return c.html(registerDonePage(username, Boolean(email)), 201);
});

authRoutes.get("/profile", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(`/login?next=${encodeURIComponent("/profile")}`);
  return c.html(profilePage(user, await csrfFor(c)));
});

authRoutes.post("/profile/password", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect(`/login?next=${encodeURIComponent("/profile")}`);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const current = String(form.get("current_password") ?? "");
  const password = String(form.get("new_password") ?? "");
  const confirmation = String(form.get("confirm_password") ?? "");
  const account = await c.env.DB.prepare("SELECT password_hash FROM user WHERE id = ? AND status = 'active'").bind(user.id).first<{ password_hash: string }>();
  if (!account || !verifyPassword(account.password_hash, current)) {
    return c.html(profilePage(user, await csrfFor(c), "当前密码不正确。"), 400);
  }
  if (!validPassword(password, confirmation)) {
    return c.html(profilePage(user, await csrfFor(c), "新密码需为 8–128 位，且两次输入一致。"), 400);
  }
  const result = await c.env.DB.prepare(
    "UPDATE user SET password_hash = ?, auth_version = auth_version + 1 WHERE id = ? AND auth_version = ? AND status = 'active'"
  ).bind(hashPassword(password), user.id, user.auth_version).run();
  if (result.meta.changes !== 1) return c.text("账号状态已变化，请重新登录后再试。", 409);
  clearSession(c);
  return c.redirect("/login?password_changed=1", 303);
});
