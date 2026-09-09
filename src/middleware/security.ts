import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Frame-Options", "DENY");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (new URL(c.req.url).protocol === "https:")
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://*.r2.cloudflarestorage.com; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
};

export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};
