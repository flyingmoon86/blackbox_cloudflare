import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { drainFileCleanup } = await loadModule("src/services/file-cleanup.ts");
async function setup(t) {
  const db = createDatabase();
  t.after(() => db.close());
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'合成甲'),(2,'合成乙'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'synthetic-admin','fixture','admin',NULL),(2,'synthetic-owner','fixture','member',1),(3,'synthetic-peer','fixture','member',2),(4,'synthetic-user','fixture','user',NULL); UPDATE storage_budget SET initialized=1",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "synthetic-gallery",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3, 4])
    cookies[id] =
      "blackbox_csrf=fixture; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (path, user = 0, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[user] || "", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (path, user, fields = {}, headers = {}) =>
    req(path, user, {
      method: "POST",
      headers,
      body: fields instanceof FormData ? fields : new URLSearchParams({ csrf: "fixture", ...fields }),
    });
  const upload = (user = 2, id = crypto.randomUUID(), extra = {}) => {
    const form = new FormData();
    form.set("csrf", "fixture");
    form.set("upload_id", id);
    form.set("members_consent", "1");
    form.set("caption", "SYNTHETIC_PHOTO_CAPTION");
    form.set(
      "photo",
      new File([new Uint8Array([255, 216, 255, 0, 0, 0, 0, 255, 217])], "synthetic.jpg", { type: "image/jpeg" }),
    );
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return post("/profile/members/1/photos", user, form);
  };
  const row = (id) => db.prepare("SELECT * FROM member_featured_photo WHERE id=?").get(id);
  const action = (id, user, action, extra = {}) =>
    post(`/profile/members/1/photos/${id}`, user, { version: String(row(id).version), action, ...extra });
  return { db, env, req, post, upload, row, action };
}
test("pending photo queue is admin-only and excludes reviewed, withdrawn and archived photos", async (t) => {
  const f = await setup(t),
    id = crypto.randomUUID();
  await f.upload(2, id);
  for (const user of [0, 2, 3, 4]) {
    const response = await f.req("/admin/member-photos", user);
    assert.ok([401, 403].includes(response.status));
    assert.doesNotMatch(await response.text(), /合成甲|SYNTHETIC_PHOTO_CAPTION/);
  }
  let response = await f.req("/admin/member-photos", 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(await response.text(), /待审核 1 张/);
  assert.equal((await f.action(id, 1, "approve")).status, 303);
  assert.match(await (await f.req("/admin/member-photos", 1)).text(), /目前没有待审核/);
  await f.action(id, 2, "edit", { caption: "modified" });
  await f.action(id, 2, "withdraw");
  assert.match(await (await f.req("/admin/member-photos", 1)).text(), /目前没有待审核/);
  await f.action(id, 2, "publish");
  await f.action(id, 2, "archive");
  assert.match(await (await f.req("/admin/member-photos", 1)).text(), /目前没有待审核/);
});
test("featured photos live in member dossier for certified readers only; graduation stays separate", async (t) => {
  const f = await setup(t),
    id = crypto.randomUUID(),
    file = `/members/1/photos/${id}/file`;
  assert.equal((await f.upload(2, id)).status, 303);
  assert.equal((await f.upload(2, id)).status, 303);
  assert.equal(f.row(id).status, "pending");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_featured_photo").get().n, 1);
  assert.equal((await f.req(file, 2)).status, 200);
  assert.equal((await f.req(file)).status, 404);
  let body = await (await f.req("/members/1")).text();
  assert.match(body, /id="member-photos"/);
  assert.doesNotMatch(body, /SYNTHETIC_PHOTO_CAPTION|毕业去向|重要时刻/);
  assert.equal((await f.action(id, 2, "approve")).status, 403);
  assert.equal((await f.action(id, 1, "approve")).status, 303);
  body = await (await f.req("/members/1", 3)).text();
  assert.match(body, /SYNTHETIC_PHOTO_CAPTION/);
  const response = await f.req(file, 3);
  assert.equal(response.status, 200);
  const etag = response.headers.get("etag");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const user of [0, 4]) {
    const page = await f.req("/members/1", user);
    assert.doesNotMatch(await page.text(), /SYNTHETIC_PHOTO_CAPTION|\/photos\/[^/]+\/file/);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    assert.equal(page.headers.get("x-blackbox-navigation"), null);
    for (const options of [
      {},
      { method: "HEAD" },
      { headers: { Range: "bytes=0-3" } },
      { headers: { "If-None-Match": etag } },
      { headers: { "If-Modified-Since": "Wed, 01 Jan 2099 00:00:00 GMT" } },
      { headers: { Range: "bytes=0-3", "If-Range": etag } },
    ]) {
      const original = f.env.FILES.head;
      f.env.FILES.head = () => assert.fail("uncertified storage read");
      try {
        const r = await f.req(file, user, options);
        assert.equal(r.status, 404);
        assert.equal(r.headers.get("etag"), null);
      } finally {
        f.env.FILES.head = original;
      }
    }
  }
  const peerPage = await f.req("/members/1", 3);
  assert.equal(peerPage.headers.get("cache-control"), "private, no-store");
  assert.equal(peerPage.headers.get("x-blackbox-navigation"), null);

  assert.equal((await f.req(file, 3, { method: "HEAD" })).status, 200);
  assert.equal((await f.req(file, 3, { headers: { Range: "bytes=0-3" } })).status, 206);
  assert.equal((await f.req(file, 3, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await f.action(id, 2, "withdraw")).status, 303);
  assert.equal((await f.req(file, 3, { headers: { "If-None-Match": etag } })).status, 404);
  assert.doesNotMatch(await (await f.req("/members/1")).text(), /SYNTHETIC_PHOTO_CAPTION/);
  assert.equal((await f.action(id, 1, "approve")).status, 409);
  assert.equal((await f.action(id, 2, "publish")).status, 303);
  assert.equal(f.row(id).status, "pending");
  assert.equal((await f.req(file)).status, 404);
  assert.equal((await f.req("/graduation/1", 3)).status, 404);
  assert.doesNotMatch(await (await f.req("/graduation/1", 2)).text(), /精选照片|重要时刻|type="file"/);
  // The new route middleware must not intercept existing dossier editor routes.
  assert.equal((await f.req("/admin/members/1/edit", 1)).status, 200);
  assert.equal((await f.req("/profile/member", 2)).status, 200);
});
test("pending photos, management and history reject unauthorized users before R2 on all HTTP variants", async (t) => {
  const f = await setup(t),
    id = crypto.randomUUID();
  assert.equal((await f.upload(2, id)).status, 303);
  for (const user of [0, 3, 4]) {
    for (const path of [
      "/profile/members/1/photos",
      "/admin/members/1/photos",
      `/profile/members/1/photos/${id}/history`,
    ])
      assert.ok([401, 403, 404].includes((await f.req(path, user)).status));
    assert.ok([401, 403, 404].includes((await f.action(id, user, "publish")).status));
    for (const options of [
      {},
      { method: "HEAD" },
      { headers: { Range: "bytes=0-3" } },
      { headers: { "If-None-Match": "*" } },
      { headers: { "If-Modified-Since": "Wed, 01 Jan 2099 00:00:00 GMT" } },
      { headers: { Range: "bytes=0-3", "If-Range": "*" } },
    ]) {
      const original = f.env.FILES.head;
      f.env.FILES.head = () => assert.fail("unauthorized storage read");
      try {
        const r = await f.req(`/members/1/photos/${id}/file`, user, options);
        assert.equal(r.status, 404);
        assert.equal(r.headers.get("etag"), null);
      } finally {
        f.env.FILES.head = original;
      }
    }
  }
  assert.equal((await f.req(`/profile/members/1/photos/${id}/history`, 2)).status, 403);
  assert.equal((await f.req(`/admin/members/1/photos/${id}/history`, 1)).status, 200);
  assert.equal((await f.req("/" + f.row(id).object_key)).status, 404);
  f.db.exec("UPDATE user SET auth_version=1 WHERE id=2");
  assert.equal((await f.req("/profile/members/1/photos", 2)).status, 401);
});
test("gallery CSRF, ownership, version conflict, moderation, archive recovery and immutable audit", async (t) => {
  const f = await setup(t),
    id = crypto.randomUUID();
  assert.equal((await f.upload(2, id, { members_consent: "0" })).status, 400);
  assert.equal((await f.upload(2, id, { csrf: "bad" })).status, 400);
  assert.equal((await f.upload(3, id)).status, 404);
  assert.equal((await f.upload(2, id)).status, 303);
  assert.equal((await f.action(id, 1, "approve")).status, 303);
  assert.equal((await f.action(id, 2, "edit", { version: "1", caption: "stale" })).status, 409);
  assert.equal((await f.action(id, 2, "edit", { caption: "<script>synthetic</script>" })).status, 303);
  assert.equal(f.row(id).status, "pending");
  assert.doesNotMatch(await (await f.req("/profile/members/1/photos", 2)).text(), /<script>synthetic/);
  assert.equal((await f.action(id, 1, "reject")).status, 303);
  assert.equal((await f.req(`/members/1/photos/${id}/file`, 2)).status, 404);
  assert.equal((await f.action(id, 2, "archive")).status, 303);
  assert.equal((await f.action(id, 2, "restore")).status, 403);
  assert.equal((await f.action(id, 1, "restore")).status, 303);
  assert.equal(f.row(id).members_consent, 0);
  assert.equal(f.row(id).status, "pending");
  assert.equal((await f.action(id, 1, "approve")).status, 409);
  assert.equal((await f.post("/admin/members/1/delete", 1, { confirm_name: "合成甲" })).status, 409);
  assert.throws(
    () => f.db.prepare("UPDATE member_featured_photo_history SET caption='tampered' WHERE photo_id=?").run(id),
    /HISTORY_IMMUTABLE/,
  );
  assert.throws(
    () => f.db.prepare("DELETE FROM member_featured_photo_history WHERE photo_id=?").run(id),
    /HISTORY_IMMUTABLE/,
  );
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_featured_photo_history WHERE photo_id=?").get(id).n, 6);
});
test("gallery upload cleanup releases failed writes and retains archived references", async (t) => {
  const f = await setup(t),
    original = f.env.FILES.put;
  f.env.FILES.put = async (...args) => {
    await original(...args);
    throw Error("synthetic PUT acknowledgement loss");
  };
  assert.equal((await f.upload()).status, 500);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_featured_photo").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM storage_reservation").get().n, 0);
  assert.equal((await f.env.FILES.list()).objects.length, 0);
  f.env.FILES.put = original;
  const id = crypto.randomUUID();
  assert.equal((await f.upload(2, id)).status, 303);
  await f.action(id, 2, "archive");
  f.db.prepare("INSERT INTO file_cleanup_task(object_key) VALUES(?)").run(f.row(id).object_key);
  await drainFileCleanup(f.env);
  assert.ok(await f.env.FILES.head(f.row(id).object_key));
});
test("approved gallery rechecks certification, binding and session revocation for every request", async (t) => {
  const f = await setup(t),
    id = crypto.randomUUID(),
    path = `/members/1/photos/${id}/file`;
  assert.equal((await f.upload(2, id)).status, 303);
  assert.equal((await f.action(id, 1, "approve")).status, 303);
  assert.equal((await f.req(path, 3)).status, 200);
  for (const update of [
    "role='user'",
    "member_id=NULL",
    "status='disabled'",
    "auth_version=1",
    "must_change_password=1",
  ]) {
    f.db.exec(
      "UPDATE user SET role='member',member_id=2,status='active',auth_version=0,must_change_password=0 WHERE id=3",
    );
    f.db.exec(`UPDATE user SET ${update} WHERE id=3`);
    for (const options of [
      {},
      { method: "HEAD" },
      { headers: { "If-None-Match": "*" } },
      { headers: { Range: "bytes=0-3" } },
    ]) {
      const response = await f.req(path, 3, options);
      assert.ok([303, 404].includes(response.status));
      assert.equal(response.headers.get("etag"), null);
    }
    assert.doesNotMatch(await (await f.req("/members/1", 3)).text(), /SYNTHETIC_PHOTO_CAPTION/);
  }
});
test("split migration preserves legacy private photos and history without publishing them", (t) => {
  const db = createDatabase(25);
  t.after(() => db.close());
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'合成历史'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(2,'synthetic','fixture','member',1); INSERT INTO member_record(id,member_id,kind,audience,consent_by,updated_by) VALUES('old-destination',1,'destination','members',2,2),('old-moment',1,'moment','admins',NULL,2); INSERT INTO member_record_photo(id,record_id,object_key,status,updated_by) VALUES('old-photo','old-moment','synthetic-private/photo.jpg','approved',2)",
  );
  const before = db.prepare("SELECT * FROM member_record_photo").get();
  db.exec(readFileSync("migrations/0026_member_featured_photos.sql", "utf8"));
  db.exec(readFileSync("migrations/0027_featured_photos_members_only.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM member_record_photo").get(), before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_featured_photo").get().n, 0);
  assert.equal(db.prepare("SELECT audience FROM member_record WHERE id='old-destination'").get().audience, "admins");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_record_history WHERE record_id='old-destination'").get().n, 2);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});
