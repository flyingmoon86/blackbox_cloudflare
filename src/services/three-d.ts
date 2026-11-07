export type ThreeDScene = {
  id: string;
  title: string;
  description: string;
  sort_order: number;
  status: "draft" | "published" | "archived";
  production_id: number | null;
  edition_id: number | null;
  model_key: string | null;
  model_filename: string | null;
  cover_key: string | null;
  cover_filename: string | null;
  pending_model_key: string | null;
  pending_model_filename: string | null;
  pending_cover_key: string | null;
  pending_cover_filename: string | null;
  updated_at: string;
  revision: number;
};

export type ThreeDSceneView = Pick<ThreeDScene, "id" | "title" | "description" | "production_id"> & {
  production_title?: string | null;
  edition_name?: string | null;
};

export const threeDSceneIsPublic =
  "scene.status='published' AND (scene.production_id IS NULL OR EXISTS(SELECT 1 FROM production WHERE id=scene.production_id AND is_hidden=0))";

export function threeDSceneFiles(scene: ThreeDScene, preview: boolean) {
  return {
    model:
      preview && scene.pending_model_key
        ? { key: scene.pending_model_key, name: scene.pending_model_filename }
        : { key: scene.model_key, name: scene.model_filename },
    cover:
      preview && scene.pending_cover_key
        ? { key: scene.pending_cover_key, name: scene.pending_cover_filename }
        : { key: scene.cover_key, name: scene.cover_filename },
  };
}

export async function getThreeDScene(db: D1Database, id: string, publicOnly = false) {
  return db
    .prepare(
      `SELECT scene.* FROM three_d_scene scene WHERE scene.id=?${publicOnly ? " AND " + threeDSceneIsPublic : ""}`,
    )
    .bind(id)
    .first<ThreeDScene>();
}
