import { Hono } from "hono";
import type { AppEnv } from "../types";
import { helpPage } from "../views/help";

export const helpRoutes = new Hono<AppEnv>();

helpRoutes.get("/help", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT page_texts FROM site_profile WHERE id=1").first<{ page_texts: string }>();
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(row?.page_texts || "{}");
  } catch {}
  return c.html(helpPage(texts, user?.role === "admin", Boolean(user)));
});
