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
  assert.equal((await s.req(0, "/help")).headers.get("Location"), "/thanks");
  const help = await (await s.req(0, "/help")).text();
  assert.ok(!help.includes('id="captain-guide"'));
});

test("photo detail keeps gallery context and offers adjacent navigation", async () => {
  const s = await setup();
  const editionId = s.db
    .prepare("SELECT id FROM production_edition WHERE production_id=1 ORDER BY id LIMIT 1")
    .get().id;
  s.db
    .prepare("UPDATE resource SET production_id=1,edition_id=?,created_at='2026-09-17 12:00:00' WHERE id=1")
    .run(editionId);
  const insert = s.db.prepare(
    "INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,uploader_id,production_id,edition_id,created_at) VALUES(?,?,'photo','approved',?,?,?,2,1,?,'2026-09-18 12:00:00')",
  );
  for (let id = 4; id <= 10; id++) {
    const title = id === 9 ? "fba8aaea93f64e67b08f05639314dc49.jpg" : `剧照 ${id}`;
    insert.run(id, title, `photo-${id}.jpg`, `photo-${id}.jpg`, `photo-${id}-preview.jpg`, editionId);
  }

  const detail = await (await s.req(0, "/resources/9?origin=9&page=2")).text();
  assert.match(detail, /<h1>测试作品 · 剧照 2<\/h1>/);
  assert.match(detail, /data-photo-previous href="\/resources\/10\?origin=9&amp;page=2"/);
  assert.match(detail, /data-photo-next href="\/resources\/8\?origin=9&amp;page=2"/);
  assert.match(detail, /<strong>2<\/strong> \/ 8/);
  assert.match(detail, /href="\/productions\/1\?edition=\d+&amp;page=2&amp;photo=9#edition-\d+-resources"/);
  assert.match(detail, /资料标题：<code>fba8aaea93f64e67b08f05639314dc49\.jpg<\/code>/);
  assert.match(detail, /data-resource-media-error hidden/);

  const production = await (await s.req(0, `/productions/1?edition=${editionId}`)).text();
  assert.match(production, /data-photo-lightbox href="\/resources\/9\?origin=9&amp;page=1"/);
  assert.match(production, /data-photo-lightbox[^>]*data-caption="[^"]+"/);
  assert.doesNotMatch(production, /data-photo-lightbox[^>]*title=/);
  assert.match(production, /data-photo-dialog/);
  assert.match(production, /data-photo-detail href="\/resources"/);
});
test("redundant duplicate entries are trimmed while primary paths stay reachable", async () => {
  const s = await setup();
  s.db.prepare("UPDATE site_profile SET featured_production_id=1 WHERE id=1").run();
  const home = await (await s.req(0, "/")).text();
  assert.doesNotMatch(home, /class="stage-feature"/);
  assert.equal((home.match(/进入作品/g) || []).length, 1);

  const production = await (await s.req(0, "/productions/1")).text();
  assert.match(production, /← 返回作品档案/);
  assert.doesNotMatch(production, /查看资料库/);

  const resource = await (await s.req(0, "/resources/3")).text();
  assert.match(resource, /返回资料列表/);
  assert.doesNotMatch(resource, /查看资料库/);
  assert.doesNotMatch(resource, /返回作品档案/);

  const library = await (await s.req(0, "/resources")).text();
  assert.doesNotMatch(library, /href="\/resources">已入库资料/);
  assert.doesNotMatch(library, /剧照请进入作品档案查看/);
  assert.match(library, /href="\/resources\/submit">提交资料/);
});
test("edit and account forms no longer render decorative rules", async () => {
  const s = await setup();
  for (const [id, path] of [
    [2, "/profile"],
    [2, "/profile/member"],
    [1, "/admin/members/1/edit"],
    [1, "/admin/resources/3/edit"],
  ]) {
    const response = await s.req(id, path);
    assert.equal(response.status, 200, path);
    assert.doesNotMatch(await response.text(), /<hr\b/, path);
  }
});
test("guest flowers are CSRF protected, deduplicated per day and counted publicly", async () => {
  const s = await setup();
  assert.equal((await s.post(0, "/members/1/flowers", { csrf: "wrong" })).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await s.post(0, "/members/1/flowers")).status, 303);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM visitor_flower").get().n, 1);
  assert.match(await (await s.req(0, "/members/1")).text(), /<strong>1<\/strong> 朵花/);
});
test("named flowers show cumulative names and retain anonymous counts", async () => {
  const s = await setup();
  await s.post(0, "/members/1/flowers");
  await s.post(3, "/members/1/flowers");
  await s.post(3, "/members/1/flowers");
  const html = await (await s.req(0, "/members/1")).text();
  assert.match(html, /<strong>2<\/strong> 朵花/);
  assert.match(html, /普通账号/);
  assert.match(html, /匿名/);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM flower").get().n, 1);
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
  const edit = await (await s.req(1, "/admin/members/1/edit")).text();
  assert.match(edit, /name="join_year"[^>]*type="text"/);
  assert.match(edit, /name="cohort"[^>]*type="text"/);
  assert.match(edit, /<option value="2000"><\/option>/);
  assert.equal(
    (await s.post(2, "/profile/member", { join_year: "2000", cohort: "2000", bio: "简介", works: "作品" })).status,
    303,
  );
  assert.match(await (await s.req(0, "/members/1")).text(), /2000 级/);
  assert.equal((await s.post(2, "/profile/member", { cohort: "2024届" })).status, 400);
  s.db.exec("UPDATE member SET cohort='旧记录' WHERE id=1");
  await s.post(1, "/admin/members/1/edit", { name: "测试队员", cohort: "", join_year: "2025", bio: "新版简介" });
  assert.equal(s.db.prepare("SELECT cohort FROM member WHERE id=1").get().cohort, "旧记录");
});

test("administrators cannot create or rename duplicate member profiles and can delete with confirmation", async () => {
  const s = await setup();
  s.db.exec(
    "INSERT INTO member(id,name) VALUES(20,'重复档案'),(21,'待删档案'); UPDATE user SET member_id=20,role='member' WHERE id=2;",
  );
  assert.equal(
    (await s.post(1, "/admin/members/new", { name: " 重复档案 ", join_year: "", cohort: "", bio: "" })).status,
    409,
  );
  assert.equal(
    (await s.post(1, "/admin/members/21/edit", { name: "重复档案", join_year: "", cohort: "", bio: "" })).status,
    409,
  );
  assert.equal((await s.post(2, "/admin/members/21/delete", { confirm_name: "待删档案" })).status, 403);
  assert.equal((await s.post(1, "/admin/members/21/delete", { confirm_name: "错误" })).status, 400);
  assert.equal((await s.post(1, "/admin/members/21/delete", { confirm_name: "待删档案" })).status, 303);
  assert.equal(s.db.prepare("SELECT id FROM member WHERE id=21").get(), undefined);
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
        productionId: 1,
        editionId: 1,
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

test("library paginates scripts with stable groups and excludes photos", async () => {
  const s = await setup();
  for (let id = 10; id < 40; id++)
    s.db
      .prepare(
        "INSERT INTO resource(id,title,res_type,status,filename,production_id) VALUES(?,?,'script','approved','fixture.pdf',1)",
      )
      .run(id, "演出图片" + id);
  const first = await (await s.req(0, "/resources?q=测试作品")).text();
  assert.match(first, /第 1 \/ 2 页/);
  assert.equal((first.match(/class="resource-card type-script"/g) || []).length, 24);
  assert.ok(!first.includes("演出图片10"));
  const last = await (await s.req(0, "/resources?q=测试作品&page=999")).text();
  assert.match(last, /第 2 \/ 2 页/);
  assert.match(last, /演出图片10/);
  assert.ok(!last.includes("待审图"));
  const all = await (await s.req(0, "/resources?page=2")).text();
  assert.ok(all.indexOf("演出图片10") < all.indexOf("其他资料"));
  s.db.close();
});

test("work themes are admin-only and old years and profile works survive unrelated edits", async () => {
  const s = await setup();
  s.db.exec("UPDATE production SET year=2019 WHERE id=1; UPDATE member SET works='历史原文',join_year=2018 WHERE id=1");
  assert.equal(
    (await s.post(3, "/admin/productions/1/edit", { title: "测试作品", theme_color: "#335577" })).status,
    403,
  );
  assert.equal(
    (await s.post(1, "/admin/productions/1/edit", { title: "测试作品", theme_color: "red;bad" })).status,
    400,
  );
  assert.equal(
    (await s.post(1, "/admin/productions/1/edit", { title: "测试作品", theme_color: "#335577", year: "" })).status,
    303,
  );
  assert.equal(s.db.prepare("SELECT year FROM production WHERE id=1").get().year, 2019);
  assert.match(await (await s.req(0, "/site/theme.css?production=1")).text(), /--brand:#335577/);
  assert.match(await (await s.req(0, "/productions/1")).text(), /theme.css\?production=1/);
  assert.equal((await s.post(2, "/profile/member", { bio: "新简介", join_year: "", cohort: "" })).status, 303);
  const row = s.db.prepare("SELECT works,join_year FROM member WHERE id=1").get();
  assert.equal(row.works, "历史原文");
  assert.equal(row.join_year, 2018);
  s.db.exec("INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(1,1,'cast','角色')");
  const detail = await (await s.req(0, "/members/1")).text();
  assert.match(detail, /舞台经历/);
  assert.match(detail, /测试作品/);
  assert.ok(!detail.includes("历史原文"));
  const edit = await (await s.req(2, "/profile/member")).text();
  assert.ok(!edit.includes('name="works"'));
  assert.match(edit, /name="join_year"[^>]*value="2018"/);
  s.db.close();
});

test("avatar thumbnail is optional, accounted for, served and removed with original", async () => {
  const s = await setup();
  const { replaceAvatar } = await loadModule("src/services/avatars.ts");
  const original = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 255, 217]);
  const preview = new Uint8Array([255, 216, 255, 224, 255, 217]);
  await replaceAvatar(s.env, 2, 1, "jpg", "image/jpeg", original, preview);
  const row = s.db.prepare("SELECT photo,avatar_preview FROM member WHERE id=1").get();
  assert.ok(row.avatar_preview);
  assert.ok(await s.env.FILES.head(row.photo));
  assert.deepEqual(new Uint8Array(await (await s.req(0, "/members/1/avatar")).arrayBuffer()), preview);
  assert.equal(
    s.db.prepare("SELECT size_bytes FROM storage_object WHERE object_key=?").get(row.avatar_preview).size_bytes,
    preview.length,
  );
  assert.equal((await s.post(1, "/admin/members/1/avatar/delete")).status, 303);
  assert.equal(await s.env.FILES.head(row.avatar_preview), null);
  assert.equal(await s.env.FILES.head(row.photo), null);
  s.db.close();
});

test("section backgrounds accept approved previews only and cannot expose pending media", async () => {
  const s = await setup();
  const form = { troupe_name: "话剧队", productions_background: "1", members_background: "1", thanks_background: "1" };
  assert.equal((await s.post(3, "/admin/site", form)).status, 403);
  assert.equal((await s.post(1, "/admin/site", { ...form, members_background: "2" })).status, 400);
  assert.equal((await s.post(1, "/admin/site", form)).status, 303);
  const settings = JSON.parse(s.db.prepare("SELECT page_texts FROM site_profile WHERE id=1").get().page_texts);
  assert.equal(settings.productions_background, "1");
  assert.equal(settings.members_background, "1");
  assert.equal(settings.thanks_background, "1");
  for (const section of ["productions", "members", "thanks"])
    assert.equal((await s.req(0, `/site/background?section=${section}`)).status, 200);
  assert.equal((await s.req(0, "/site/background?section=unknown")).status, 204);
  s.db.exec("UPDATE resource SET status='pending' WHERE id=1");
  assert.equal((await s.req(0, "/site/background?section=members")).status, 204);
  const editor = await (await s.req(1, "/admin/site")).text();
  assert.match(editor, /页面编辑/);
  assert.match(editor, /name="thanks_background"/);
  assert.doesNotMatch(editor, /name="page_background_photo"|name="member_guide"|name="admin_guide"/);
  s.db.close();
});

test("selected display assets serve original bytes without exposing unselected or pending files", async () => {
  const s = await setup();
  const original = new Uint8Array([255, 216, 255, 1, 2, 3, 255, 217]);
  await s.env.FILES.put("original.jpg", original);
  s.db.prepare("UPDATE site_profile SET hero_photo='1',featured_production_id=1,page_texts=? WHERE id=1").run(
    JSON.stringify({
      mascot_photo: "1",
      productions_background: "1",
      recruitment_poster: "1",
      recruitment_poster_mobile: "2",
    }),
  );
  s.db.exec("UPDATE production SET cover_id=1 WHERE id=1");
  for (const path of [
    "/site/hero",
    "/site/mascot",
    "/site/background?section=productions",
    "/site/featured-cover",
    "/site/poster",
    "/site/poster?variant=mobile&id=2",
  ]) {
    const r = await s.req(0, path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(new Uint8Array(await r.arrayBuffer()), original, path);
  }
  assert.equal((await s.req(0, "/resources/1/media")).status, 302);
  s.db.exec("UPDATE resource SET status='pending' WHERE id=1");
  for (const path of ["/site/hero", "/site/mascot", "/site/featured-cover", "/site/poster?id=2"])
    assert.equal((await s.req(0, path)).status, 404, path);
  assert.equal((await s.req(0, "/site/background?section=productions")).status, 204);
});

test("all production covers expose only the selected approved original", async () => {
  const s = await setup();
  const bytes = new Uint8Array([255, 216, 255, 5, 6, 255, 217]);
  await s.env.FILES.put("original.jpg", bytes);
  s.db.exec("UPDATE production SET cover_id=1 WHERE id=1");
  const response = await s.req(0, "/productions/1/cover?id=2");
  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  for (const path of ["/productions", "/productions/1"])
    assert.match(await (await s.req(0, path)).text(), /src="\/productions\/1\/cover\?v=1"/);
  assert.equal((await s.req(0, "/productions/999/cover")).status, 404);
  s.db.exec("UPDATE resource SET status='pending' WHERE id=1");
  assert.equal((await s.req(0, "/productions/1/cover")).status, 404);
  assert.equal((await s.req(0, "/resources/1/media")).status, 302);
});

test("dismissed notifications remain pending until the actual task is processed", async () => {
  const s = await setup();
  let data = await (await s.req(1, "/admin/notifications")).json();
  assert.equal(data.pendingTotal, 1);
  assert.equal(data.total, 1);
  assert.equal((await s.post(1, "/admin/notifications/dismiss", { key: "resource:2" })).status, 200);
  data = await (await s.req(1, "/admin/notifications")).json();
  assert.equal(data.total, 0);
  assert.equal(data.pendingTotal, 1);
  assert.equal(data.pending[0].href, "/admin/resources/reviews");
  const dashboard = await (await s.req(1, "/admin")).text();
  assert.match(dashboard, /data-pending-message>有 1 项任务等待处理/);
  s.db.exec("UPDATE resource SET status='rejected' WHERE id=2");
  data = await (await s.req(1, "/admin/notifications")).json();
  assert.equal(data.pendingTotal, 0);
  assert.equal((await s.req(3, "/admin/notifications")).status, 403);
});

test("announcement reminder changes only with the newest announcement content and escapes titles", async () => {
  const s = await setup();
  const revision = async (user = 0) => {
    const html = await (await s.req(user, "/")).text();
    return { html, key: html.match(/data-announcement-update="([a-f0-9]{64})"/)?.[1] };
  };
  const first = await revision();
  assert.ok(first.key);
  assert.equal((await revision()).key, first.key);
  assert.match(first.html, /data-announcement-user="guest"/);
  assert.match((await revision(2)).html, /data-announcement-user="2"/);
  s.db.exec("UPDATE announcement SET content='更新正文' WHERE id=1");
  assert.notEqual((await revision()).key, first.key);
  s.db.prepare("UPDATE announcement SET title=? WHERE id=1").run("<img src=x onerror=alert(1)>");
  assert.match((await revision()).html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  s.db.exec("DELETE FROM announcement");
  assert.equal((await revision()).key, undefined);
});
