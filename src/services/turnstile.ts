import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { tryGetContext } from "hono/context-storage";
import type { AppEnv } from "../types";

export function turnstileWidget(action: "signup" | "feedback"): string {
  const c = tryGetContext<AppEnv>();
  if (!c || c.env.TURNSTILE_ENABLED !== "true" || (action === "feedback" && c.get("user"))) return "";
  const key = c.env.TURNSTILE_SITE_KEY || "";
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) return '<p role="alert">安全验证暂不可用，请稍后再试。</p>';
  return `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><div class="cf-turnstile" data-sitekey="${key}" data-action="${action}" data-size="flexible"></div>`;
}

export async function verifyTurnstile(c: Context<AppEnv>, form: FormData, action: "signup" | "feedback") {
  if (c.env.TURNSTILE_ENABLED !== "true" || (action === "feedback" && c.get("user"))) return;
  const token = form.get("cf-turnstile-response");
  const hosts = (c.env.TURNSTILE_HOSTNAMES || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (
    !c.env.TURNSTILE_SECRET ||
    !hosts.length ||
    (c.env.ENVIRONMENT === "production" && hosts.some((h) => ["localhost", "127.0.0.1"].includes(h)))
  )
    throw new HTTPException(503, { message: "安全验证暂不可用，请稍后再试。" });
  if (typeof token !== "string" || !token || token.length > 2048)
    throw new HTTPException(403, { message: "请完成安全验证后重新提交。" });
  let result: { success?: boolean; hostname?: string; action?: string };
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ secret: c.env.TURNSTILE_SECRET, response: token }),
    });
    if (!response.ok) throw new Error("verification unavailable");
    result = await response.json();
  } catch {
    throw new HTTPException(503, { message: "安全验证暂不可用，请稍后再试。" });
  }
  if (result?.success !== true || result.action !== action || !hosts.includes(result.hostname || ""))
    throw new HTTPException(403, { message: "安全验证失效，请刷新页面后重新提交。" });
}
