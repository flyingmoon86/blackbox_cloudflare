import { Hono } from "hono";
import type { AppEnv } from "../types";
import { canAccessProduction } from "../services/production-visibility";
import { registerEditionsRoutes } from "./productions/editions";
import { registerPublicRoutes } from "./productions/public";
import { registerAdminRoutes } from "./productions/admin";
import { registerCreditsRoutes } from "./productions/credits";

export const productionRoutes = new Hono<AppEnv>();

// Preserve the original registration order: edition handlers have their own admin guard.
registerEditionsRoutes(productionRoutes);

productionRoutes.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/productions") && !c.req.path.startsWith("/admin/production")) return next();
  const target = /^\/productions\/([^/]+)(?:\/|$)/.exec(c.req.path);
  if (target && !(await canAccessProduction(c, Number(target[1])))) return c.text("未找到这部作品。", 404);
  if (
    !c.get("user") &&
    !((c.req.method === "GET" || c.req.method === "HEAD") && /^\/productions(?:\/\d+(?:\/cover)?)?$/.test(c.req.path))
  )
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

registerPublicRoutes(productionRoutes);
registerAdminRoutes(productionRoutes);
registerCreditsRoutes(productionRoutes);
