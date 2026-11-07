import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";

const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const csrf = "three-d-fixture-csrf";
const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCOAKwv/9k=",
  "base64",
);

function gaussian(x = 0, count = 1) {
  const fields = [
    "x",
    "y",
    "z",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "opacity",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ];
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "element vertex " + count,
    ...fields.map((name) => "property float " + name),
    "end_header",
    "",
  ].join("\n");
  const vertex = Buffer.alloc(fields.length * 4);
  vertex.writeFloatLE(x, 0);
  vertex.writeFloatLE(1, fields.indexOf("rot_0") * 4);
  const payload = Buffer.alloc(vertex.byteLength * count).fill(vertex);
  return Buffer.concat([Buffer.from(header), payload]);
}

async function fixture(t) {
  const db = createDatabase();
  t.after(() => db.close());
  db.exec(`
    INSERT INTO user(id,username,password_hash,role) VALUES(1,'三维测试管理员','fixture','admin'),(2,'三维测试普通用户','fixture','user');
    INSERT INTO production(id,title,is_hidden) VALUES(101,'三维测试公开作品',0),(102,'三维测试隐藏作品',1);
  `);
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "three-d-synthetic-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  for (const id of ["03", "05"]) {
    await env.FILES.put("three-d-archive/" + id + "/model.ply", gaussian(Number(id)));
    await env.FILES.put("three-d-archive/" + id + "/cover.jpg", jpeg);
  }
  const cookies = {};
  for (const id of [1, 2]) {
    const token = await createSession(
      { uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
      env.SESSION_SECRET,
    );
    cookies[id] = "blackbox_csrf=" + csrf + "; blackbox_session=" + token;
  }
  const request = (role, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { cookie: cookies[role] || "", ...options.headers },
      }),
      env,
      context(),
    );
  const form = (role, path, fields = {}) =>
    request(role, path, { method: "POST", body: new URLSearchParams({ csrf, ...fields }) });
  const api = (role, path, method = "GET", body, headers = {}) =>
    request(role, path, { method, body, headers: { "x-csrf-token": csrf, ...headers } });
  const row = (id) => db.prepare("SELECT * FROM three_d_scene WHERE id = ?").get(id);
  return { db, env, request, form, api, row };
}

const publicAsset = (id, kind = "model") => "/3d/scenes/" + id + "/" + kind;
const adminScene = (id) => "/admin/three-d/" + id;
const uploadBase = (id) => "/api/admin/3d/scenes/" + id;

async function bytes(response, status = 200) {
  assert.equal(response.status, status, response.url);
  return Buffer.from(await response.arrayBuffer());
}

async function putModel(s, id, model) {
  const base = uploadBase(id) + "/uploads";
  const create = await s.api(
    1,
    base,
    "POST",
    JSON.stringify({ originalName: "更新.ply", sizeBytes: model.byteLength }),
    {
      "content-type": "application/json",
    },
  );
  assert.equal(create.status, 201, await create.clone().text());
  const task = await create.json();
  const taskPath = base + "/" + task.id;
  assert.equal((await s.api(1, taskPath + "/parts/1", "PUT", model.subarray(0, 8))).ok, false);
  assert.deepEqual((await (await s.api(1, taskPath)).json()).parts, []);
  assert.equal((await s.api(1, taskPath + "/parts/1", "PUT", model)).status, 200);
  const resumed = await (await s.api(1, taskPath)).json();
  assert.equal(resumed.parts.length, 1);
  assert.equal(resumed.parts[0].partNumber, 1);
  assert.equal(resumed.parts[0].sizeBytes, model.byteLength);
  assert.equal((await s.api(1, taskPath + "/complete", "POST")).status, 200);
  assert.equal(
    (await s.api(1, taskPath + "/complete", "POST")).status,
    200,
    "a lost completion response can be retried",
  );
}

test("3D migration preserves public names and old object URLs, including HEAD and Range", async (t) => {
  const s = await fixture(t);
  const response = await s.request(0, "/3d");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /黑匣子动物园/);
  assert.match(html, /一个男人的心就这么轻轻的碎了/);
  for (const id of ["03", "05"]) {
    assert.equal(s.row(id).status, "published");
    assert.ok(html.includes(publicAsset(id)));
    assert.deepEqual(await bytes(await s.request(0, publicAsset(id, "cover"))), jpeg);
    const head = await s.request(0, publicAsset(id), { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get("content-length")), gaussian(Number(id)).byteLength);
    assert.equal(await head.text(), "");
    const ranged = await s.request(0, publicAsset(id), { headers: { Range: "bytes=0-2" } });
    assert.equal(ranged.headers.get("content-range"), "bytes 0-2/" + gaussian(Number(id)).byteLength);
    assert.equal((await bytes(ranged, 206)).toString(), "ply");
  }
  s.env.ENVIRONMENT = "production";
  assert.equal((await s.request(0, "/3d")).status, 404);
  s.env.THREE_D_ARCHIVE_ENABLED = "true";
  assert.equal((await s.request(0, "/3d")).status, 200);
});

test("lossless model transfer keeps authorization, revalidation, replacement and raw Range semantics", async (t) => {
  const s = await fixture(t);
  const key = s.row("03").model_key;
  const source = await s.env.FILES.head(key);
  const raw = gaussian(3);
  const compressed = gzipSync(raw);
  await s.env.FILES.put(key + ".transfer-" + source.etag + ".gz", compressed);
  const path = publicAsset("03") + "?transfer=gzip";
  const response = await s.request(0, path);
  assert.equal(response.headers.get("x-model-compression"), "gzip");
  assert.equal(Number(response.headers.get("content-length")), compressed.length);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  const etag = response.headers.get("etag");
  assert.deepEqual(gunzipSync(await bytes(response)), raw);
  assert.equal((await s.request(0, path, { headers: { "If-None-Match": etag } })).status, 304);
  assert.equal((await s.request(0, path, { method: "HEAD" })).headers.get("x-model-compression"), "gzip");
  const ranged = await s.request(0, path, { headers: { Range: "bytes=0-2" } });
  assert.equal(ranged.headers.get("x-model-compression"), null);
  assert.equal((await bytes(ranged, 206)).toString(), "ply");
  await s.env.FILES.put(key, gaussian(4));
  const replaced = await s.request(0, path, { headers: { "If-None-Match": etag } });
  assert.equal(replaced.headers.get("x-model-compression"), null);
  assert.deepEqual(await bytes(replaced), gaussian(4));
  s.db.exec("UPDATE three_d_scene SET status='archived' WHERE id='03'");
  for (const options of [
    {},
    { method: "HEAD" },
    { headers: { "If-None-Match": etag } },
    { headers: { Range: "bytes=0-2" } },
  ]) {
    assert.equal((await s.request(0, path, options)).status, 404);
  }
});

test("only administrators can create, upload, preview and publish a complete 3D draft", async (t) => {
  const s = await fixture(t);
  const fields = { title: '测试场景"><img src=x onerror=alert(1)>', description: "合成预览", sort_order: 1 };
  assert.equal((await s.form(2, "/admin/three-d", fields)).status, 403);
  assert.equal((await s.form(1, "/admin/three-d", { ...fields, csrf: "invalid" })).status, 400);
  const created = await s.form(1, "/admin/three-d", fields);
  assert.equal(created.status, 303, await created.clone().text());
  const id = s.db.prepare("SELECT id FROM three_d_scene WHERE title = ?").get(fields.title).id;
  assert.equal(s.row(id).status, "draft");
  assert.equal((await s.form(1, adminScene(id) + "/publish", { revision: s.row(id).revision })).ok, false);
  assert.equal((await s.api(2, uploadBase(id) + "/cover", "PUT", jpeg, { "content-type": "image/jpeg" })).status, 403);
  assert.equal(
    (await s.api(1, uploadBase(id) + "/cover", "PUT", jpeg, { "content-type": "image/jpeg", "x-csrf-token": "bad" }))
      .status,
    400,
  );

  await putModel(s, id, gaussian(12));
  const cover = await s.api(1, uploadBase(id) + "/cover", "PUT", jpeg, { "content-type": "image/jpeg" });
  assert.equal(cover.status, 200, await cover.clone().text());
  assert.equal((await s.request(0, publicAsset(id))).status, 404);
  assert.equal((await s.request(2, adminScene(id) + "/preview/model")).status, 403);
  const preview = await s.request(1, adminScene(id) + "/preview");
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy"), /worker-src 'self' blob:/);
  assert.deepEqual(await bytes(await s.request(1, adminScene(id) + "/preview/model")), gaussian(12));
  assert.equal((await s.form(1, adminScene(id) + "/publish", { revision: s.row(id).revision })).status, 303);
  const html = await (await s.request(0, "/3d")).text();
  assert.match(html, /合成预览/);
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.deepEqual(await bytes(await s.request(0, publicAsset(id))), gaussian(12));
});

test("replacement remains private until publish and archival denies all file variants before R2", async (t) => {
  const s = await fixture(t);
  const id = "03",
    base = adminScene(id),
    asset = publicAsset(id),
    initial = s.row(id).revision;
  const before = await s.request(0, asset);
  const etag = before.headers.get("etag");
  assert.deepEqual(await bytes(before), gaussian(3));
  await putModel(s, id, gaussian(42));
  assert.deepEqual(await bytes(await s.request(0, asset)), gaussian(3));
  assert.deepEqual(await bytes(await s.request(1, base + "/preview/model")), gaussian(42));
  assert.equal((await s.form(1, base + "/publish", { revision: initial })).status, 409);
  assert.equal((await s.form(1, base + "/publish", { revision: s.row(id).revision })).status, 303);
  assert.deepEqual(await bytes(await s.request(0, asset)), gaussian(42));

  const edited = await s.form(1, base, {
    title: "改名测试",
    description: "合成描述",
    sort_order: 4,
    production_id: 102,
    revision: s.row(id).revision,
  });
  assert.equal(edited.status, 303, await edited.clone().text());
  assert.equal((await s.request(0, asset)).status, 404, "linked hidden productions suppress public model delivery");
  s.db.exec("UPDATE production SET is_hidden=0 WHERE id=102");
  assert.match(await (await s.request(0, "/3d")).text(), /改名测试/);

  assert.equal((await s.form(1, base + "/archive", { revision: s.row(id).revision })).status, 303);
  let r2Reads = 0;
  for (const method of ["head", "get"]) {
    const original = s.env.FILES[method];
    s.env.FILES[method] = (...args) => {
      r2Reads++;
      return original(...args);
    };
  }
  for (const kind of ["model", "cover"]) {
    const path = publicAsset(id, kind);
    assert.equal((await s.request(0, path)).status, 404);
    assert.equal((await s.request(0, path, { method: "HEAD" })).status, 404);
    assert.equal((await s.request(0, path, { headers: { Range: "bytes=0-2" } })).status, 404);
    assert.equal((await s.request(0, path, { headers: { "If-None-Match": etag } })).status, 404);
  }
  assert.equal(r2Reads, 0);
  assert.doesNotMatch(await (await s.request(0, "/3d")).text(), /改名测试/);
});

async function startModel(s, id, sizeBytes, fingerprint = "f".repeat(64)) {
  const url = uploadBase(id) + "/uploads";
  const response = await s.api(
    1,
    url,
    "POST",
    JSON.stringify({ originalName: "fixture.ply", sizeBytes, fingerprint }),
    { "content-type": "application/json" },
  );
  assert.equal(response.status, 201, await response.clone().text());
  const task = await response.json();
  return { task, url, path: url + "/" + task.id };
}

test("3D multipart resumes from server state, rejects generic upload API and completes across two parts", async (t) => {
  const s = await fixture(t);
  const id = "03";
  // A genuine second part using the site's configured 50 MiB first part.
  const model = gaussian(7, Math.ceil((50 * 1024 * 1024) / 56));
  const { task, url, path } = await startModel(s, id, model.byteLength);
  assert.equal(task.totalParts, 2);
  const multipartId = s.db
    .prepare("SELECT multipart_upload_id FROM upload_task WHERE id=?")
    .get(task.id).multipart_upload_id;
  const first = model.subarray(0, task.partSize);
  const second = model.subarray(task.partSize);
  assert.equal((await s.api(1, path + "/parts/1", "PUT", first)).status, 200);
  assert.equal((await s.api(1, "/api/uploads/" + task.id)).status, 404, "resource API must not expose a model task");
  assert.equal((await s.api(2, path)).status, 403);
  assert.equal((await s.api(1, uploadBase("05") + "/uploads/" + task.id)).status, 404);
  assert.equal((await s.api(1, path + "/complete", "POST")).ok, false);
  const current = await (await s.api(1, url + "/current")).json();
  assert.equal(current.id, task.id);
  assert.equal(current.fingerprint, "f".repeat(64));
  assert.deepEqual(
    current.parts.map((part) => part.partNumber),
    [1],
  );
  assert.equal(s.env.FILES.multiparts.get(multipartId).parts.size, 1);
  assert.equal((await s.api(1, path + "/parts/2", "PUT", second)).status, 200);
  assert.equal((await s.api(1, path + "/complete", "POST")).status, 200);
  assert.equal(s.env.FILES.multiparts.has(multipartId), false);
  assert.equal((await s.api(1, url + "/current")).status, 404);
  const pending = s.row(id).pending_model_key;
  assert.equal(
    s.db.prepare("SELECT size_bytes FROM storage_object WHERE object_key=?").get(pending).size_bytes,
    model.byteLength,
  );
  assert.deepEqual(await bytes(await s.request(0, publicAsset(id))), gaussian(3));
  assert.equal(
    (await s.request(1, adminScene(id) + "/preview/model", { method: "HEAD" })).headers.get("content-length"),
    String(model.byteLength),
  );
});

test("cancelling or rejecting a model releases storage and leaves the published model intact", async (t) => {
  const s = await fixture(t);
  const id = "03";
  const contents = gaussian();
  const { task, url, path } = await startModel(s, id, contents.byteLength);
  assert.equal((await s.api(1, path + "/parts/1", "PUT", contents)).status, 200);
  const cancelled = await s.api(1, path, "DELETE");
  assert.equal(cancelled.status, 200, await cancelled.clone().text());
  assert.equal((await s.api(1, url + "/current")).status, 404);
  assert.equal(s.db.prepare("SELECT status FROM upload_task WHERE id=?").get(task.id).status, "aborted");
  assert.equal(s.env.FILES.multiparts.size, 0);
  assert.equal(s.row(id).pending_model_key, null);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS count FROM storage_reservation").get().count, 0);

  // An ordinary point cloud with a .ply name must not be accepted as a Gaussian model.
  const invalid = Buffer.concat([
    Buffer.from("ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n"),
    Buffer.alloc(4),
  ]);
  const next = await startModel(s, id, invalid.byteLength);
  assert.equal((await s.api(1, next.path + "/parts/1", "PUT", invalid)).status, 200);
  assert.equal((await s.api(1, next.path + "/complete", "POST")).status, 400);
  assert.equal(s.row(id).pending_model_key, null);
  assert.equal(s.db.prepare("SELECT COUNT(*) AS count FROM storage_reservation").get().count, 0);
  assert.deepEqual(await bytes(await s.request(0, publicAsset(id))), gaussian(3));
});

test("linked 3D scenes validate the edition and remain archived after a production is deleted", async (t) => {
  const s = await fixture(t);
  s.db.exec("INSERT INTO production_edition(id,production_id,name) VALUES(201,101,'旧版本'),(202,102,'隐藏版本')");
  const id = "03";
  const path = adminScene(id);
  const revision = s.row(id).revision;
  const fields = { title: "原演出场景", sort_order: 1, production_id: 102, revision };
  const mismatch = await s.form(1, path, { ...fields, edition_id: 201 });
  assert.equal(mismatch.status, 400);
  assert.equal(s.row(id).revision, revision);
  const linked = await s.form(1, path, { ...fields, edition_id: 202 });
  assert.equal(linked.status, 303, await linked.clone().text());
  assert.equal(s.row(id).status, "published");
  assert.equal((await s.request(0, publicAsset(id))).status, 404);
  s.db.prepare("DELETE FROM production WHERE id=?").run(102);
  assert.equal(s.row(id).production_id, null);
  assert.equal(s.row(id).edition_id, null);
  assert.equal(s.row(id).status, "archived");
  assert.equal((await s.request(0, publicAsset(id))).status, 404);
});
