import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

// Negotiate only the existing successful review redirects. All authorization,
// validation and writes still happen in the original handlers.
export const reviewResponse: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  if (
    c.req.method !== "POST" ||
    c.get("user")?.role !== "admin" ||
    c.req.header("Accept") !== "application/json" ||
    c.res.status !== 303
  )
    return;
  const expected = /^\/admin\/requests\/\d+\/(approve|reject)$/.test(c.req.path)
    ? "/admin?message="
    : /^\/admin\/production-requests\/\d+\/review$/.test(c.req.path)
      ? "/admin/production-requests"
      : /^\/admin\/resources\/\d+\/review$/.test(c.req.path)
        ? "/admin/resources/reviews"
        : null;
  const location = c.res.headers.get("Location") || "";
  if (
    expected &&
    (expected.endsWith("=") ? [expected + "approved", expected + "rejected"].includes(location) : location === expected)
  ) {
    c.res.headers.delete("Location");
    c.res = c.json({ reviewed: true });
  }
};
