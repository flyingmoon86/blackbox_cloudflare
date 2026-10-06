import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");

test("production resource picker escapes titles, preserves complete selections and enforces eligible associations", async () => {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin','test','admin'),(2,'reader','test','user'); INSERT INTO production(id,title) VALUES(1,'作品甲'),(2,'作品乙');",
  );
  const add = db.prepare(
    "INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,production_id) VALUES(?,?,'photo',?,'original.jpg','original.jpg','preview.jpg',?)",
  );
  for (let id = 1; id <= 40; id++)
    add.run(
      id,
      id === 2 ? '<img src=x onerror="alert(1)">' : `剧照 ${id}`,
      id === 40 ? "pending" : "approved",
      id <= 30 ? 1 : null,
    );
  add.run(41, "其他作品资料", "approved", 2);
  add.run(42, "未归类驳回资料", "rejected", null);
  db.exec("UPDATE production SET cover_id=1 WHERE id=1");
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "resource-picker-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const req = async (path, init = {}, uid = 1) =>
    worker.fetch(
      new Request("https://picker.test" + path, {
        ...init,
        headers: {
          Cookie:
            "blackbox_csrf=picker-csrf; blackbox_session=" +
            (await createSession({ uid, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET)),
        },
      }),
      env,
      context(),
    );
  try {
    assert.equal((await req("/admin/productions/1/edit", {}, 2)).status, 403);
    const html = await (await req("/admin/productions/1/edit")).text();
    assert.equal((html.match(/name="resource_ids"/g) || []).length, 40);
    assert.equal((html.match(/name="resource_ids" value="\d+" checked/g) || []).length, 30);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    assert.doesNotMatch(html, /<img src=x/);
    assert.match(html, /data-src="\/resources\/40\/preview"/);
    assert.match(html, /data-picker-selected/);
    assert.doesNotMatch(html, /name="resource_ids" value="4[12]"/);
    const fresh = await (await req("/admin/productions/new")).text();
    assert.equal((fresh.match(/name="resource_ids"/g) || []).length, 10);
    assert.doesNotMatch(fresh, /name="resource_ids" value="\d+" checked/);
    const save = (ids) =>
      req("/admin/productions/1/edit", {
        method: "POST",
        body: new URLSearchParams([
          ["csrf", "picker-csrf"],
          ["title", "作品甲"],
          ["cover_id", "1"],
          ...ids.map((id) => ["resource_ids", String(id)]),
        ]),
      });
    assert.equal((await save([1, 41])).status, 409);
    assert.equal((await save([2, 3])).status, 400);
    const wanted = [...Array.from({ length: 29 }, (_, i) => i + 1), 40];
    assert.equal((await save(wanted)).status, 303);
    assert.deepEqual(
      db
        .prepare("SELECT id FROM resource WHERE production_id=1 ORDER BY id")
        .all()
        .map((x) => x.id),
      wanted,
    );
    assert.equal(db.prepare("SELECT status FROM resource WHERE id=40").get().status, "pending");
    assert.equal(db.prepare("SELECT production_id FROM resource WHERE id=30").get().production_id, null);
  } finally {
    db.close();
  }
});
