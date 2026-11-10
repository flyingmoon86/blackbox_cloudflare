import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase, d1, loadModule } from "./harness.mjs";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
const { saveProduction } = await loadModule("src/services/productions/save.ts");
const { selectedResourcesAllowed } = await loadModule("src/services/productions/queries.ts");

test("local D1 runtime preserves batch SELECT results and rolls back all writes on failure", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default { fetch() { return new Response('fixture') } }",
      compatibilityDate: "2026-09-08",
      d1Databases: ["DB"],
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await db.batch([
      db.prepare(
        "CREATE TABLE production(id INTEGER PRIMARY KEY,title TEXT,synopsis TEXT,promo TEXT,year INTEGER,cover_ratio TEXT,feature_layout TEXT,cover_id INTEGER,theme_color TEXT,is_hidden INTEGER)",
      ),
      db.prepare("CREATE TABLE resource(id INTEGER PRIMARY KEY,production_id INTEGER,status TEXT,res_type TEXT)"),
      db.prepare("INSERT INTO production(id,title) VALUES(1,'before')"),
      db.prepare(
        "INSERT INTO resource VALUES(1,1,'approved','photo'),(2,1,'approved','photo'),(3,NULL,'pending','photo')",
      ),
      db.prepare(
        "CREATE TRIGGER fail_attach BEFORE UPDATE OF production_id ON resource WHEN NEW.id=3 BEGIN SELECT RAISE(ABORT,'attach_failed'); END",
      ),
    ]);
    const edit = {
      id: 1,
      title: "after",
      synopsis: "",
      promo: "",
      year: null,
      coverRatio: "landscape",
      featureLayout: "split",
      cover: 1,
      theme: null,
      hidden: null,
      resourceIds: [1, 3],
    };
    await assert.rejects(saveProduction(db, edit), /attach_failed/);
    assert.equal(await db.prepare("SELECT title FROM production WHERE id=1").first("title"), "before");
    assert.equal(await db.prepare("SELECT production_id FROM resource WHERE id=2").first("production_id"), 1);
    await db.prepare("DROP TRIGGER fail_attach").run();
    assert.equal(await saveProduction(db, edit), "saved");
    assert.equal(await db.prepare("SELECT production_id FROM resource WHERE id=2").first("production_id"), null);
    assert.equal(await db.prepare("SELECT production_id FROM resource WHERE id=3").first("production_id"), 1);
  } finally {
    await mf.dispose();
  }
});
function fixture() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO production(id,title) VALUES(1,'before'),(2,'other'); INSERT INTO resource(id,title,res_type,status,production_id,filename,original_name) VALUES(1,'cover','photo','approved',1,'image.jpg','image.jpg'),(2,'detach','photo','approved',1,'image.jpg','image.jpg'),(3,'attach','photo','pending',NULL,'image.jpg','image.jpg'),(4,'foreign','photo','approved',2,'image.jpg','image.jpg'),(5,'rejected','photo','rejected',NULL,'image.jpg','image.jpg'); UPDATE production SET cover_id=1 WHERE id=1;",
  );
  const edit = {
    id: 1,
    title: "after",
    synopsis: "updated",
    promo: "",
    year: null,
    coverRatio: "landscape",
    featureLayout: "split",
    cover: 1,
    theme: null,
    hidden: null,
    resourceIds: [1, 3],
  };
  const snapshot = () => ({
    production: db.prepare("SELECT * FROM production ORDER BY id").all(),
    resources: db.prepare("SELECT * FROM resource ORDER BY id").all(),
  });
  return { db, edit, snapshot, env: d1(db) };
}
test("production edit rolls back metadata, detach and attach when a later write fails", async () => {
  const f = fixture();
  try {
    const before = f.snapshot();
    f.db.exec(
      "CREATE TRIGGER injected_failure BEFORE UPDATE OF production_id ON resource WHEN NEW.id=3 BEGIN SELECT RAISE(ABORT,'injected attach failure'); END;",
    );
    await assert.rejects(saveProduction(f.env, f.edit), /injected attach failure/);
    assert.deepEqual(f.snapshot(), before);
    f.db.exec("DROP TRIGGER injected_failure");
    assert.equal(await saveProduction(f.env, f.edit), "saved");
    assert.equal(f.db.prepare("SELECT title FROM production WHERE id=1").get().title, "after");
    assert.equal(f.db.prepare("SELECT production_id FROM resource WHERE id=2").get().production_id, null);
    assert.equal(f.db.prepare("SELECT production_id FROM resource WHERE id=3").get().production_id, 1);
  } finally {
    f.db.close();
  }
});
test("save rechecks ownership in its transaction and invalid edits change nothing", async () => {
  const f = fixture();
  try {
    assert.equal(await selectedResourcesAllowed(f.env, [1, 3], 1), true);
    f.db.exec("UPDATE resource SET production_id=2 WHERE id=3");
    let before = f.snapshot();
    assert.equal(await saveProduction(f.env, f.edit), "conflict");
    assert.deepEqual(f.snapshot(), before);
    assert.equal(await saveProduction(f.env, { ...f.edit, id: 999, resourceIds: [], cover: null }), "missing");
    assert.deepEqual(f.snapshot(), before);
    assert.equal(await saveProduction(f.env, { ...f.edit, cover: 4, resourceIds: [1] }), "cover");
    assert.deepEqual(f.snapshot(), before);
    assert.equal(await saveProduction(f.env, { ...f.edit, cover: null, resourceIds: [] }), "saved");
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM resource WHERE production_id=1").get().n, 0);
  } finally {
    f.db.close();
  }
});
test("selection validation accepts only selected eligible IDs and skips an empty selection", async () => {
  const f = fixture();
  try {
    assert.equal(await selectedResourcesAllowed(f.env, [], null), true);
    assert.equal(f.env.calls, 0);
    for (const [ids, production, expected] of [
      [[3], null, true],
      [[1], null, false],
      [[1, 3], 1, true],
      [[4], 1, false],
      [[5], 1, false],
      [[999], 1, false],
    ])
      assert.equal(await selectedResourcesAllowed(f.env, ids, production), expected);
  } finally {
    f.db.close();
  }
});
