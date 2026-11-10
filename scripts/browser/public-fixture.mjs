import { navigationFixture } from "../navigation-fixture.mjs";
import { readFileSync } from "node:fs";

export function publicFixture() {
  return navigationFixture(0, async ({ db, files }) => {
    const image = readFileSync("public/images/productions-unlit.webp");
    await files.put("cover-1.webp", image, { httpMetadata: { contentType: "image/webp" } });
    await files.put("preview-1.webp", image, { httpMetadata: { contentType: "image/webp" } });
    db.exec(
      "UPDATE member SET photo='cover-1.webp',avatar_preview='preview-1.webp',cohort=2024 WHERE id=1; UPDATE resource SET edition_id=(SELECT id FROM production_edition WHERE production_id=1 ORDER BY id DESC LIMIT 1) WHERE id=1; UPDATE announcement SET created_at='2026-11-09 00:00:00';",
    );
    for (const id of ["03", "05"]) {
      const key = `three-d-archive/${id}/fixture.webp`;
      await files.put(key, image, { httpMetadata: { contentType: "image/webp" } });
      db.prepare("UPDATE three_d_scene SET cover_key=?,cover_filename='fixture.webp' WHERE id=?").run(key, id);
    }
  });
}
