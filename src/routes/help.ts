import { Hono } from "hono";
import type { AppEnv } from "../types";
export const helpRoutes = new Hono<AppEnv>();
// Preserve old bookmarks without retaining the removed guide surface.
helpRoutes.get("/help", (c) => c.redirect("/thanks", 302));
