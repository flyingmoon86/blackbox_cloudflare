import type { Context } from "hono";
import type { AppEnv } from "../types";
import { csrfFor } from "../http/cookies";
import { consumeRules } from "../middleware/request-limits";

export async function visitorIdentity(c: Context<AppEnv>): Promise<string> {
  const user = c.get("user");
  if (user) return "user:" + user.id;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(await csrfFor(c)));
  return "visitor:" + Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function publicLimit(c: Context<AppEnv>, scope: string, maximum: number): Promise<number> {
  return consumeRules(c, [
    { scope, subject: await visitorIdentity(c), maximum, seconds: 3600 },
    {
      scope: scope + "-network",
      subject: c.req.header("CF-Connecting-IP") || "local",
      maximum: maximum * 30,
      seconds: 3600,
    },
  ]);
}
