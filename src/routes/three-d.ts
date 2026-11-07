import { Hono } from "hono";
import { adminPortal } from "../services/admin-portal";
import { serveResourceFile } from "../services/resource-files";
import { serveThreeDModel } from "../services/three-d-transfer";
import { getThreeDScene, threeDSceneFiles, threeDSceneIsPublic, type ThreeDSceneView } from "../services/three-d";
import { threeDArchiveEnabled } from "../shared/three-d-archive";
import type { AppEnv } from "../types";
import { threeDArchivePage } from "../views/three-d";

export const threeDRoutes = new Hono<AppEnv>();

threeDRoutes.use("/3d/*", async (c, next) => {
  if (!threeDArchiveEnabled(c.env) || adminPortal(c)?.active) return c.notFound();
  await next();
});

threeDRoutes.get("/3d", async (c) => {
  const scenes = await c.env.DB.prepare(
    `SELECT scene.id,scene.title,scene.description,scene.production_id,production.title AS production_title,edition.name AS edition_name
     FROM three_d_scene scene LEFT JOIN production ON production.id=scene.production_id
     LEFT JOIN production_edition edition ON edition.id=scene.edition_id
     WHERE ${threeDSceneIsPublic} ORDER BY scene.sort_order,scene.id`,
  ).all<ThreeDSceneView>();
  const user = c.get("user");
  return c.html(threeDArchivePage(scenes.results, Boolean(user), user?.role === "admin"));
});

threeDRoutes.on(["GET", "HEAD"], "/3d/scenes/:id/:kind", async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "cover" && kind !== "model") return c.notFound();
  const scene = await getThreeDScene(c.env.DB, c.req.param("id"), true);
  if (!scene) return c.notFound();
  const file = threeDSceneFiles(scene, false)[kind];
  if (!file.key) return c.notFound();
  if (kind === "model") return serveThreeDModel(c.req.raw, c.env.FILES, file.key, file.name || "model.ply");
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: file.key,
    filename: file.name || (kind === "cover" ? "cover.jpg" : "model.ply"),
    publicImage: kind === "cover",
  });
});
