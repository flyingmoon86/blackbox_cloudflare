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
    "default-src 'self'; script-src 'self'; object-src 'none'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://*.r2.cloudflarestorage.com; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
};

// Reject browser cross-site writes before parsing a body or querying the database.
// Non-browser clients without Origin must still pass each route's CSRF/auth checks.
export const sameOriginWrites: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if ((origin && origin !== new URL(c.req.url).origin) || c.req.header("Sec-Fetch-Site") === "cross-site")
      return c.text("不接受跨站提交，请在本站重新操作。", 403);
  }
  await next();
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
