import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadModule, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { reserveStorage, ensureStorageBudget, uploadPolicy } = await loadModule("src/services/upload-policy.ts");
const { completeUpload } = await loadModule("src/services/uploads.ts");
const { drainFileCleanup, fileCleanupStatements } = await loadModule("src/services/file-cleanup.ts");
const { cleanExpiredUploads } = await loadModule("src/storage/cleanup.ts");
const jpeg = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 255, 217]);
async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name) VALUES(20,'甲'),(40,'乙');INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'admin','test','admin',NULL),(2,'member','test','member',20),(3,'visitor','test','user',NULL),(4,'other','test','member',40);",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "test-only-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3, 4])
    cookies[id] =
      "blackbox_csrf=fixture-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const request = (id, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "", "x-csrf-token": "fixture-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const create = (id = 2, overrides = {}) =>
    request(id, "/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "剧照",
        resType: "photo",
        originalName: "photo.jpg",
        contentType: "image/jpeg",
        sizeBytes: jpeg.length,
        ...overrides,
      }),
    });
  const put = (id, task, bytes = jpeg) =>
    request(id, "/api/uploads/" + task + "/parts/1", { method: "PUT", body: bytes });
  const complete = (id, task) => request(id, "/api/uploads/" + task + "/complete", { method: "POST" });
  return { db, env, request, create, put, complete };
}
test("upload role/ownership/CSRF boundaries and video limits are checked before any R2 task", async () => {
  const s = await setup();
  assert.equal((await s.create(0)).status, 401);
  assert.equal((await s.create(2, { resType: "video" })).status, 403);
  assert.equal((await s.create(2, { originalName: "renamed.mp4", resType: "other" })).status, 403);
  assert.equal((await s.create(2, { sizeBytes: uploadPolicy.limits.photo + 1 })).status, 413);
  assert.equal(s.env.FILES.multiparts.size, 0);
  assert.equal(
    (await s.request(2, "/api/uploads", { method: "POST", headers: { "x-csrf-token": "bad" }, body: "{}" })).status,
    400,
  );
  const response = await s.create();
  assert.equal(response.status, 201);
  const task = await response.json();
  assert.equal((await s.put(4, task.id)).status, 404);
  assert.equal((await s.request(4, "/api/uploads/" + task.id)).status, 404);
});
test("actual truncated/oversized parts are rejected and a retry can finish exactly one resource", async () => {
  const s = await setup(),
    task = await (await s.create()).json();
  assert.equal((await s.put(2, task.id, jpeg.slice(0, 8))).status, 400);
  assert.equal((await s.put(2, task.id, new Uint8Array(40))).status, 400);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM upload_part").get().n, 0);
  assert.equal((await s.put(2, task.id)).status, 200);
  const first = await s.complete(2, task.id);
  assert.equal(first.status, 200);
  const result = await first.json();
  assert.equal(result.status, "approved");
  const second = await s.complete(2, task.id);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).resourceId, result.resourceId);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
  assert.equal(s.db.prepare("SELECT reserved_bytes FROM storage_budget").get().reserved_bytes, 0);
  assert.equal(s.db.prepare("SELECT used_bytes FROM storage_budget").get().used_bytes, jpeg.length);
});
test("D1 commit failure after R2 completion is recoverable without uploading or creating a second resource", async () => {
  const s = await setup(),
    task = await (await s.create()).json();
  await s.put(2, task.id);
  const original = s.env.DB.batch;
  s.env.DB.batch = async () => {
    throw Error("simulated database unavailable");
  };
  assert.equal((await s.complete(2, task.id)).status, 500);
  assert.equal(s.env.FILES.objects.size, 1);
  assert.equal(s.db.prepare("SELECT status FROM upload_task").get().status, "completing");
  assert.ok(s.db.prepare("SELECT reserved_bytes FROM storage_budget").get().reserved_bytes > 0);
  s.env.DB.batch = original;
  await cleanExpiredUploads(s.env);
  assert.equal(s.db.prepare("SELECT status FROM upload_task").get().status, "completed");
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
  assert.equal((await s.complete(2, task.id)).status, 200);
  const failed = await (await s.create()).json();
  await s.put(2, failed.id);
  const resume = s.env.FILES.resumeMultipartUpload;
  s.env.FILES.resumeMultipartUpload = (...args) => ({
    ...resume(...args),
    complete: async () => {
      throw Error("R2 merge failed");
    },
  });
  assert.equal((await s.complete(2, failed.id)).status, 500);
  assert.equal(s.db.prepare("SELECT status FROM upload_task WHERE id=?").get(failed.id).status, "uploading");
  s.env.FILES.resumeMultipartUpload = resume;
  assert.equal((await s.request(2, "/api/uploads/" + failed.id, { method: "DELETE" })).status, 200);
});
test("inventoried legacy objects and unfinished uploads count toward the 9GB cap; concurrency is bounded", async () => {
  const s = await setup();
  await s.env.FILES.put("legacy-avatar.jpg", jpeg);
  await ensureStorageBudget(s.env);
  assert.equal(s.db.prepare("SELECT used_bytes FROM storage_budget").get().used_bytes, jpeg.length);
  for (let n = 0; n < 3; n++) assert.equal((await s.create()).status, 201);
  assert.equal((await s.create()).status, 429);
  s.db.exec("INSERT INTO storage_object(object_key,size_bytes) VALUES('large-legacy-object',8999999980);");
  await assert.rejects(reserveStorage(s.env, { id: "extra", bytes: 30 }), (e) => e.status === 413);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM storage_reservation").get().n, 3);
});
test("cancel is idempotent; expired previews/parts stop accepting writes and are cleaned", async () => {
  const s = await setup(),
    task = await (await s.create()).json();
  assert.equal(
    (
      await s.request(2, "/api/uploads/" + task.id + "/preview", {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: jpeg,
      })
    ).status,
    200,
  );
  s.db.exec("UPDATE upload_task SET expires_at='2000-01-01 00:00:00';");
  assert.equal((await s.put(2, task.id)).status, 410);
  assert.equal(
    (
      await s.request(2, "/api/uploads/" + task.id + "/preview", {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: jpeg,
      })
    ).status,
    410,
  );
  await cleanExpiredUploads(s.env);
  assert.equal(s.env.FILES.objects.size, 0);
  assert.equal(s.env.FILES.multiparts.size, 0);
  assert.equal(s.db.prepare("SELECT reserved_bytes FROM storage_budget").get().reserved_bytes, 0);
  assert.equal((await s.request(2, "/api/uploads/" + task.id, { method: "DELETE" })).status, 200);
});
test("malformed images and renamed video content cannot enter the library", async () => {
  for (const bytes of [new TextEncoder().encode("<html>bad</html>"), new TextEncoder().encode("0000ftypisom0000")]) {
    const s = await setup(),
      task = await (await s.create(2, { sizeBytes: bytes.length })).json();
    assert.equal((await s.put(2, task.id, bytes)).status, 200);
    assert.ok([400, 403].includes((await s.complete(2, task.id)).status));
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 0);
    assert.equal(s.env.FILES.objects.size, 0);
  }
});
test("deletion is database-first, retries R2 failures, and never removes a shared key", async () => {
  const s = await setup();
  await ensureStorageBudget(s.env);
  await s.env.FILES.put("shared.jpg", jpeg);
  s.db.exec(
    "INSERT INTO storage_object VALUES('shared.jpg',16);INSERT INTO resource(id,title,filename) VALUES(70,'甲','shared.jpg'),(71,'乙','shared.jpg');",
  );
  const remove = (id) =>
    s.request(1, "/admin/resources/" + id + "/delete", {
      method: "POST",
      body: new URLSearchParams({ csrf: "fixture-csrf" }),
    });
  assert.equal((await remove(70)).status, 303);
  assert.ok(s.env.FILES.objects.has("shared.jpg"));
  const original = s.env.FILES.delete;
  s.env.FILES.delete = async () => {
    throw Error("unavailable");
  };
  assert.equal((await remove(71)).status, 303);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM file_cleanup_task").get().n, 1);
  assert.equal(s.db.prepare("SELECT used_bytes FROM storage_budget").get().used_bytes, 16);
  s.env.FILES.delete = original;
  s.db.exec("UPDATE file_cleanup_task SET next_attempt_at='2000-01-01';");
  await drainFileCleanup(s.env);
  assert.equal(s.env.FILES.objects.size, 0);
  assert.equal(s.db.prepare("SELECT used_bytes FROM storage_budget").get().used_bytes, 0);
});
test("private media authorizes before 304/HEAD, supports byte ranges and forces unsafe types to attachments", async () => {
  const s = await setup();
  await s.env.FILES.put("test.html", "<script>bad</script>", { httpMetadata: { contentType: "text/html" } });
  s.db.exec(
    "INSERT INTO resource(id,title,filename,original_name,uploader_id,status) VALUES(70,'未审文件','test.html','test.html',2,'pending');",
  );
  assert.equal((await s.request(4, "/resources/70/media")).status, 403);
  assert.equal((await s.request(0, "/resources/70/media")).status, 302);
  let response = await s.request(2, "/resources/70/media");
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.match(response.headers.get("content-disposition"), /^attachment/);
  const etag = response.headers.get("etag");
  assert.equal((await s.request(2, "/resources/70/media", { headers: { "if-none-match": etag } })).status, 304);
  assert.equal(
    (await s.request(4, "/resources/70/media", { method: "HEAD", headers: { "if-none-match": etag } })).status,
    403,
  );
  response = await s.request(2, "/resources/70/media", { headers: { range: "bytes=0-3" } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), "<scr");
  assert.equal((await s.request(2, "/resources/70/media", { headers: { range: "bytes=999-" } })).status, 416);
  response = await s.request(2, "/resources/70/media", { headers: { range: "bytes=0-3", "if-range": '"other"' } });
  assert.equal(response.status, 200);
  assert.equal((await s.request(2, "/resources/70/download")).status, 404);
  s.db.exec("UPDATE resource SET status='approved',download_count=7;");
  response = await s.request(4, "/resources/70/download", { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(s.db.prepare("SELECT download_count FROM resource").get().download_count, 7);
});
test("avatar failures preserve previous image and retain cleanup/accounting; success replaces it", async () => {
  const s = await setup();
  const upload = () => {
    const form = new FormData();
    form.set("csrf", "fixture-csrf");
    form.set("avatar", new File([jpeg], "photo.jpg", { type: "image/jpeg" }));
    return s.request(2, "/profile/member/avatar", { method: "POST", body: form });
  };
  assert.equal((await upload()).status, 303);
  const old = s.db.prepare("SELECT photo FROM member WHERE id=20").get().photo;
  const original = s.env.FILES.put;
  s.env.FILES.put = async () => {
    throw Error("injected failure");
  };
  assert.equal((await upload()).status, 500);
  assert.equal(s.db.prepare("SELECT photo FROM member WHERE id=20").get().photo, old);
  s.env.FILES.put = original;
  assert.ok(s.env.FILES.objects.has(old));
  assert.equal((await upload()).status, 303);
  const current = s.db.prepare("SELECT photo FROM member WHERE id=20").get().photo;
  assert.notEqual(current, old);
  assert.equal(s.env.FILES.objects.size, 1);
  assert.equal(s.db.prepare("SELECT used_bytes FROM storage_budget").get().used_bytes, jpeg.length);
});
test("concurrent completion commits once and revoked accounts cannot finish uploads", async () => {
  const s = await setup(),
    task = await (await s.create()).json();
  await s.put(2, task.id);
  const results = await Promise.all([s.complete(2, task.id), s.complete(2, task.id)]);
  assert.ok(results.some((r) => r.status === 200));
  assert.ok(results.every((r) => r.status === 200 || r.status === 409));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
  const revoked = await (await s.create()).json();
  await s.put(2, revoked.id);
  s.db.exec("UPDATE user SET status='disabled' WHERE id=2");
  await assert.rejects(completeUpload(s.env, revoked.id), (e) => e.status === 403);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
});
test("administrator-only operations expose history and accounting without granting visitors access", async () => {
  const s = await setup();
  for (const path of ["/admin/review-history", "/admin/system", "/admin/system/check"]) {
    assert.equal((await s.request(0, path)).status, 302);
    assert.equal((await s.request(3, path)).status, 403);
    assert.equal((await s.request(1, path)).status, 200);
  }
});
