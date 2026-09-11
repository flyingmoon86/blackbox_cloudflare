import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv, Bindings } from "../types";

const encoder = new TextEncoder();
type LimitRule = { scope: string; subject: string; maximum: number; seconds: number };

async function digest(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Atomic bounded counters work across Worker instances; raw IPs and names are never stored. */
export async function consumeAuthLimit(
  c: Context<AppEnv>,
  action: "login" | "register" | "password",
  username = "",
): Promise<number> {
  // CF-Connecting-IP is supplied by Cloudflare. Do not accept user-controlled X-Forwarded-For.
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const rules: LimitRule[] =
    action === "login"
      ? [
          { scope: "login-ip", subject: ip, maximum: 180, seconds: 900 },
          { scope: "login-account-ip", subject: `${ip}\n${username.toLowerCase()}`, maximum: 12, seconds: 900 },
        ]
      : action === "register"
        ? [{ scope: "register-ip", subject: ip, maximum: 60, seconds: 3600 }]
        : [{ scope: "password-account", subject: String(c.get("user")!.id), maximum: 12, seconds: 900 }];
  return consumeRules(c, rules);
}

/** Call after authentication/CSRF/input validation, before creating requests or R2 uploads. */
export async function consumeAccountLimit(
  c: Context<AppEnv>,
  scope: string,
  maximum: number,
  seconds = 3600,
): Promise<number> {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "请先登录。" });
  return consumeRules(c, [{ scope, subject: String(user.id), maximum, seconds }]);
}

async function consumeRules(c: Context<AppEnv>, rules: LimitRule[]): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  for (const rule of rules) {
    const windowEnd = (Math.floor(now / rule.seconds) + 1) * rule.seconds;
    const key = await digest(c.env.SESSION_SECRET, `${rule.scope}\n${rule.subject}\n${windowEnd}`);
    const row = await c.env.DB.prepare(
      `INSERT INTO request_limit (key, hits, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET hits = request_limit.hits + 1
       WHERE request_limit.hits < ? RETURNING hits`,
    )
      .bind(key, windowEnd, rule.maximum)
      .first<{ hits: number }>();
    if (!row) return Math.max(1, windowEnd - now);
  }
  return 0;
}

export async function cleanExpiredRequestLimits(env: Bindings): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM request_limit WHERE key IN (SELECT key FROM request_limit WHERE expires_at <= ? ORDER BY expires_at LIMIT 200)",
  )
    .bind(Math.floor(Date.now() / 1000))
    .run();
}
