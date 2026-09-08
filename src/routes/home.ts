import { Hono } from "hono";
import { csrfFor } from "../http/cookies";
import type { AppEnv } from "../types";
import { memberHome, publicHome } from "../views";

export const homeRoutes = new Hono<AppEnv>();

homeRoutes.get("/", async (c) => {
  const user = c.get("user");
  return c.html(user ? memberHome(user, await csrfFor(c)) : publicHome());
});

homeRoutes.get("/health", (c) => c.json({ ok: true, runtime: "typescript-worker" }));
