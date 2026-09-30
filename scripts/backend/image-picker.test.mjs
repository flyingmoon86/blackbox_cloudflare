import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin','test','admin'),(2,'ordinary','test','user'); INSERT INTO production(id,title) VALUES(1,'第一作品'),(2,'');",
  );
  // Deliberately corrupt this isolated fixture to represent imported legacy inconsistencies.
  db.exec(
    "PRAGMA foreign_keys=OFF; DROP TRIGGER resource_edition_insert_validate; DROP TRIGGER resource_edition_update_validate;",
  );
  const add = db.prepare(
    "INSERT INTO resource(id,title,res_type,status,filename,production_id,edition_id,preview_filename) VALUES(?,?,'photo','approved','original.jpg',?,?,'preview.jpg')",
  );
  for (const row of [
    [1, "原有选择", 1, 1],
    [2, "独立海报", null, null],
    [3, "作品缺失", 999, null],
    [4, "仅有版本", null, 2],
    [5, "版本冲突", 1, 2],
    [6, "版本缺失", 1, 999],
    [7, "待审", 1, 1],
    [8, "不是图片", 1, 1],
    [9, "无展示图", 2, 2],
    [10, "100%现场", 2, 2],
  ])
    add.run(...row);
  db.exec(
    "UPDATE resource SET status='pending' WHERE id=7;UPDATE resource SET res_type='script' WHERE id=8;UPDATE resource SET preview_filename='' WHERE id=9;",
  );
  for (let id = 11; id <= 325; id++) add.run(id, "资料图片 " + id, 1, 1);
  db.exec("UPDATE site_profile SET hero_photo='1',page_texts='{\"members_background\":\"1\"}' WHERE id=1");
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "picker-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2])
    cookies[id] =
      "blackbox_csrf=picker-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (path, id = 1, init = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, { ...init, headers: { Cookie: cookies[id] || "", ...init.headers } }),
      env,
      context(),
    );
  return { db, req };
}
test("image picker separates null associations from broken work/version links, paginates, searches literally and preserves save rules", async () => {
  const { db, req } = await setup();
  try {
    const before = JSON.stringify(db.prepare("SELECT id,production_id,edition_id FROM resource ORDER BY id").all());
    assert.equal((await req("/admin/image-options?field=hero_photo", 0)).status, 302);
    assert.equal((await req("/admin/image-options?field=hero_photo", 2)).status, 403);
    assert.equal((await req("/admin/image-options?field=unknown")).status, 400);
    const groups = await (await req("/admin/image-options?field=hero_photo")).json();
    assert.equal(groups.groups.find((g) => g.key === "unlinked").count, 1);
    assert.equal(groups.groups.find((g) => g.key === "issues").count, 4);
    assert.equal(groups.groups.find((g) => g.key === "production:2").title, "未命名作品 #2");
    const unlinked = await (await req("/admin/image-options?field=hero_photo&mode=images&group=unlinked")).json();
    assert.deepEqual(
      unlinked.items.map((x) => x.id),
      [2],
    );
    const issues = await (await req("/admin/image-options?field=hero_photo&mode=images&group=issues")).json();
    assert.deepEqual(
      issues.items.map((x) => x.id),
      [6, 5, 4, 3],
    );
    assert.equal((await req("/admin/image-options?field=hero_photo&mode=images")).status, 400);
    const first = await (await req("/admin/image-options?field=hero_photo&mode=images&group=production:1")).json();
    const second = await (
      await req("/admin/image-options?field=hero_photo&mode=images&group=production:1&page=2")
    ).json();
    assert.equal(first.items.length, 12);
    assert.ok(first.pages > 1);
    assert.ok(!first.items.some((a) => second.items.some((b) => a.id === b.id)));
    const literal = await (await req("/admin/image-options?field=hero_photo&mode=images&q=%25")).json();
    assert.deepEqual(
      literal.items.map((x) => x.id),
      [10],
    );
    const backgrounds = await (
      await req("/admin/image-options?field=members_background&mode=images&group=production:2")
    ).json();
    assert.deepEqual(
      backgrounds.items.map((x) => x.id),
      [10],
    );
    const hero = await (await req("/admin/image-options?field=hero_photo&mode=images&group=production:2")).json();
    assert.deepEqual(
      hero.items.map((x) => x.id),
      [10, 9],
    );
    assert.equal((await req("/admin/image-options?field=cover_id")).status, 400);
    const cover = await (await req("/admin/image-options?field=cover_id&production=1&mode=images&q=海报")).json();
    assert.equal(cover.total, 0);
    const html = await (await req("/admin/site")).text();
    assert.match(html, /<option value="1" selected>原有选择<\/option>/);
    const rejected = await req("/admin/site", 1, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://blackbox.test" },
      body: new URLSearchParams({ csrf: "picker-csrf", members_background: "9" }),
    });
    assert.equal(rejected.status, 400);
    const saved = await req("/admin/site", 1, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://blackbox.test" },
      body: new URLSearchParams({ csrf: "picker-csrf", hero_photo: "2" }),
    });
    assert.equal(saved.status, 303);
    assert.equal(db.prepare("SELECT hero_photo FROM site_profile").get().hero_photo, "2");
    assert.equal(
      JSON.stringify(db.prepare("SELECT id,production_id,edition_id FROM resource ORDER BY id").all()),
      before,
    );
  } finally {
    db.close();
  }
});
