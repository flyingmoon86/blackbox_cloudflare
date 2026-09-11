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
  const contentType = c.res.headers.get("Content-Type") || "";
  if (
    /(?:text\/html|application\/(?:json|[^;]+\+json))/.test(contentType) ||
    c.res.headers.has("Set-Cookie") ||
    (c.res.status >= 300 && c.res.status < 400 && c.res.status !== 304) ||
    c.res.status >= 400
  )
    c.header("Cache-Control", "private, no-store");
};
