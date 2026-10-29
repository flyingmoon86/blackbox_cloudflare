import { Hono } from "hono";
import type { AppEnv } from "../types";
import { helpPage } from "../views/help";
export const helpRoutes = new Hono<AppEnv>();
helpRoutes.get("/help", (c) => c.html(helpPage(Boolean(c.get("user")), c.get("user")?.role === "admin")));
