import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name,cohort,join_year) VALUES(1,'测试队员','2024',2025); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'队长','fixture','admin',NULL),(2,'队员账号','fixture','member',1),(3,'普通账号','fixture','user',NULL); INSERT INTO production(id,title) VALUES(1,'测试作品'); INSERT INTO announcement(id,title,content) VALUES(1,'公开公告','测试正文'); INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,uploader_id) VALUES(1,'已审图','photo','approved','original.jpg','original.jpg','preview.jpg',2),(2,'待审图','photo','pending','pending.jpg','pending.jpg','pending-preview.jpg',2),(3,'剧本','script','approved','script.pdf','script.pdf','',2);",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "public-test-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  for (const key of ["original.jpg", "preview.jpg", "pending.jpg", "pending-preview.jpg", "script.pdf"])
    await env.FILES.put(key, new Uint8Array([255, 216, 255, 217]));
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=public-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (id, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "blackbox_csrf=guest-public-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (id, path, fields = {}) =>
    req(id, path, {
      method: "POST",
      body: new URLSearchParams({ csrf: id ? "public-csrf" : "guest-public-csrf", ...fields }),
    });
  return { db, env, req, post };
}
test("guests browse public pages but cannot fetch originals, pending files or administrator guides", async () => {
  const s = await setup();
  for (const path of [
    "/",
    "/productions",
    "/productions/1",
    "/members",
    "/members/1",
    "/announcements",
    "/announcements/1",
    "/resources",
    "/resources/1",
    "/help",
    "/thanks",
    "/feedback",
  ]) {
    const r = await s.req(0, path);
    assert.equal(r.status, 200, path + " " + (await r.clone().text()));
  }
  assert.equal((await s.req(0, "/resources/1/preview")).status, 200);
  for (const path of ["/resources/1/media", "/resources/1/download", "/resources/submit", "/admin", "/admin/community"])
    assert.equal((await s.req(0, path)).status, 302, path);
  assert.equal((await s.req(0, "/resources/2/preview")).status, 403);
  const html = await (await s.req(0, "/resources/3")).text();
  assert.ok(!html.includes('src="/resources/3/media"'));
  const help = await (await s.req(0, "/help")).text();
  assert.ok(!help.includes('id="captain-guide"'));
});
test("guest flowers are CSRF protected, deduplicated per day and counted publicly", async () => {
  const s = await setup();
  assert.equal((await s.post(0, "/members/1/flowers", { csrf: "wrong" })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await s.post(0, "/members/1/flowers")).status, 303);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM visitor_flower").get().n, 1);
  assert.match(await (await s.req(0, "/members/1")).text(), /收到 1 朵花/);
});
test("feedback is idempotent, private text stays private and opting out hides thanks", async () => {
  const s = await setup(),
    nonce = crypto.randomUUID();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await s.post(0, "/feedback", {
          request_key: nonce,
          display_name: "热心朋友",
          content: "非公开建议正文",
          public_consent: "1",
        })
      ).status,
      303,
    );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM website_feedback").get().n, 1);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM contribution_event").get().n, 1);
  let html = await (await s.req(0, "/thanks")).text();
  assert.match(html, /热心朋友/);
  assert.ok(!html.includes("非公开建议正文"));
  await s.post(0, "/feedback", { request_key: crypto.randomUUID(), display_name: "热心朋友", content: "选择不公开" });
  html = await (await s.req(0, "/thanks")).text();
  assert.ok(!html.includes("热心朋友"));
});
test("admin grant and revoke are protected; repeated suggestions cannot undo a revocation", async () => {
  const s = await setup();
  s.db.exec("INSERT INTO member(id,name) VALUES(2,'未绑定队员');");
  const adminPage = await (await s.req(1, "/admin/community")).text();
  assert.equal((adminPage.match(/value="user:2"/g) || []).length, 1);
  assert.ok(!adminPage.includes('value="member:1"'));
  assert.ok(adminPage.includes('value="member:2"'));
  assert.ok(adminPage.includes("测试队员（账号：队员账号）"));
  assert.ok(adminPage.includes('<a href="/admin">管理</a>'));
  assert.ok(!adminPage.includes("了解黑匣子"));
  assert.ok(!(await (await s.req(0, "/")).text()).includes('<a href="/admin">管理</a>'));
  assert.equal((await s.post(3, "/admin/community", { action: "grant", target: "user:2" })).status, 403);
  assert.equal((await s.post(1, "/admin/community", { action: "grant", target: "user:2" })).status, 303);
  let html = await (await s.req(0, "/members/1")).text();
  assert.match(html, /contributor-tag/);
  const id = s.db.prepare("SELECT id FROM site_contributor").get().id;
  await s.post(1, "/admin/community", { action: "revoke", id: String(id) });
  await s.post(2, "/feedback", { request_key: crypto.randomUUID(), content: "再次建议", public_consent: "1" });
  assert.ok(s.db.prepare("SELECT revoked_at FROM site_contributor").get().revoked_at);
  html = await (await s.req(0, "/members/1")).text();
  assert.ok(!html.includes('class="contributor-tag"'));
});
test("withdrawal immediately denies public previews including conditional requests", async () => {
  const s = await setup();
  assert.equal((await s.post(3, "/admin/resources/1/revoke")).status, 403);
  assert.equal((await s.post(1, "/admin/resources/1/revoke")).status, 303);
  assert.equal((await s.req(0, "/resources/1/preview", { headers: { "If-None-Match": "*" } })).status, 403);
  assert.equal((await s.req(2, "/resources/1/preview")).status, 200);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_id=1").get().n, 1);
});
test("cohort input is numeric and unrelated profile edits preserve old data", async () => {
  const s = await setup();
  assert.equal(
    (await s.post(2, "/profile/member", { join_year: "2025", cohort: "2024", bio: "简介", works: "作品" })).status,
    303,
  );
  assert.match(await (await s.req(0, "/members/1")).text(), /2024 级/);
  assert.equal((await s.post(2, "/profile/member", { cohort: "2024届" })).status, 400);
  s.db.exec("UPDATE member SET cohort='旧记录' WHERE id=1");
  await s.post(1, "/admin/members/1/edit", { name: "测试队员", cohort: "", join_year: "2025", bio: "新版简介" });
  assert.equal(s.db.prepare("SELECT cohort FROM member WHERE id=1").get().cohort, "旧记录");
});
test("ordinary account uploads stay pending; member uploads record system approval once", async () => {
  const s = await setup(),
    bytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 255, 217]);
  for (const id of [3, 2]) {
    const headers = { "x-csrf-token": "public-csrf", "content-type": "application/json" };
    const start = await s.req(id, "/api/uploads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "新剧照",
        resType: "photo",
        originalName: "new.jpg",
        contentType: "image/jpeg",
        sizeBytes: bytes.length,
      }),
    });
    assert.equal(start.status, 201, await start.clone().text());
    const task = await start.json();
    assert.equal(
      (await s.req(id, "/api/uploads/" + task.id + "/parts/1", { method: "PUT", headers, body: bytes })).status,
      200,
    );
    const finished = await s.req(id, "/api/uploads/" + task.id + "/complete", { method: "POST", headers });
    assert.equal(finished.status, 200, await finished.clone().text());
    const result = await finished.json();
    assert.equal(result.status, id === 2 ? "approved" : "pending");
    await s.req(id, "/api/uploads/" + task.id + "/complete", { method: "POST", headers });
    const count = s.db
      .prepare("SELECT COUNT(*) n FROM review_history WHERE entity_id=? AND entity_type='resource'")
      .get(result.resourceId).n;
    assert.equal(count, id === 2 ? 1 : 0);
  }
  assert.deepEqual(s.db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("uncertain formats and duplicate fingerprints go to manual review", async () => {
  const s = await setup();
  const { completeUpload } = await loadModule("src/services/uploads.ts");
  const bytes = new Uint8Array([255, 216, 255, 224, 255, 217]);
  for (const [id, name, type, duplicate] of [
    ["uncertain", "script.docx", "script", false],
    ["duplicate", "photo.jpg", "photo", true],
  ]) {
    await s.env.FILES.put(id, bytes);
    const object = await s.env.FILES.head(id);
    if (duplicate)
      s.db.prepare("UPDATE resource SET content_fingerprint=? WHERE id=1").run(object.etag + ":" + object.size);
    s.db
      .prepare(
        "INSERT INTO upload_task(id,user_id,object_key,original_name,content_type,size_bytes,status,expires_at,title,res_type,description,upload_mode) VALUES(?,2,?,?,'application/octet-stream',?,'uploading',datetime('now','+1 day'),'待复核资料',?,'说明','local')",
      )
      .run(id, id, name, bytes.length, type);
    const result = await completeUpload(s.env, id);
    assert.equal(result.status, "pending");
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_id=?").get(result.resourceId).n, 0);
  }
});

test("appearance saves only valid admin settings and preserves existing page metadata", async () => {
  const s = await setup();
  s.db.prepare("UPDATE site_profile SET page_texts=? WHERE id=1").run(JSON.stringify({ future_key: "keep" }));
  assert.equal((await s.post(3, "/admin/site", { brand_accent: "#ff0000" })).status, 403);
  assert.equal((await s.post(1, "/admin/site", { brand_accent: "red;body{display:none}" })).status, 400);
  assert.equal((await s.post(1, "/admin/site", { brand_accent: "#336699", recruitment_poster: "2" })).status, 400);
  assert.equal((await s.post(1, "/admin/site", { brand_accent: "#336699", recruitment_poster: "1" })).status, 303);
  const saved = JSON.parse(s.db.prepare("SELECT page_texts FROM site_profile WHERE id=1").get().page_texts);
  assert.equal(saved.future_key, "keep");
  assert.equal(saved.brand_accent, "#336699");
  const css = await s.req(0, "/site/theme.css?accent=%23ff0000");
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.match(await css.text(), /--brand:#336699/);
  const html = await (await s.req(0, "/")).text();
  assert.match(html, /recruitment-poster/);
  s.db.exec("UPDATE resource SET status='pending' WHERE id=1");
  assert.ok(!(await (await s.req(0, "/")).text()).includes('class="recruitment-poster"'));
  s.db.close();
});
