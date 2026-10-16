import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";

const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");

test("built-in stage pictures select a mobile encoding while custom pairs and editor previews retain their sources", async () => {
  const db = createDatabase();
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "stage-responsive-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const page = async (path, cookie = "") => {
    const response = await worker.fetch(
      new Request("https://stage.test" + path, { headers: { Cookie: cookie } }),
      env,
      context(),
    );
    assert.equal(response.status, 200);
    return response.text();
  };
  try {
    for (const [path, prefix] of [
      ["/", "theatre"],
      ["/productions", "productions"],
      ["/resources", "productions"],
      ["/members", "members"],
      ["/thanks", "thanks"],
    ]) {
      const html = await page(path);
      for (const layer of ["unlit", "light"])
        assert.match(
          html,
          new RegExp(
            `<source media="\\(max-width:900px\\)" srcset="/assets/images-${prefix}-${layer}-mobile\\.[a-f0-9]+\\.webp">`,
          ),
        );
      assert.match(html, new RegExp(`<img data-theatre-base src="/assets/images-${prefix}-unlit\\.[a-f0-9]+\\.webp"`));
    }
    db.exec("INSERT INTO user(id,username,password_hash,role) VALUES(1,'responsive-admin','test','admin')");
    const cookie =
      "blackbox_session=" +
      (await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
    const preview = await page("/productions?stage-preview=1", cookie);
    assert.match(preview, /data-stage-preview/);
    assert.doesNotMatch(preview, /<source media="\(max-width:900px\)"/);

    const key = "11111111-1111-4111-8111-111111111111";
    const texts = JSON.stringify({
      stage_visuals: JSON.stringify({ productions: { pair: { key, width: 900, height: 1200 } } }),
    });
    db.prepare("UPDATE site_profile SET page_texts=? WHERE id=1").run(texts);
    const custom = await page("/productions");
    assert.match(
      custom,
      new RegExp(
        `<img data-theatre-base src="/site/stage-image/productions/unlit\\?v=${key}" width="900" height="1200"`,
      ),
    );
    assert.doesNotMatch(custom, /<source media="\(max-width:900px\)"/);
  } finally {
    db.close();
  }
});
