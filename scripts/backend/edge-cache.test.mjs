import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");

// Minimal Cache API stand-in; production uses the real `caches.default`.
function fakeCaches() {
  const store = new Map();
  const keyOf = (request) => (typeof request === "string" ? request : new URL(request.url).toString());
  return {
    store,
    default: {
      async match(request) {
        const entry = store.get(keyOf(request));
        if (!entry) return undefined;
        return new Response(entry.body.slice(), { status: entry.status, headers: new Headers(entry.headers) });
      },
      async put(request, response) {
        const body = new Uint8Array(await response.arrayBuffer());
        store.set(keyOf(request), { body, status: response.status, headers: new Headers(response.headers) });
      },
      async delete(request) {
        return store.delete(keyOf(request));
      },
    },
  };
}

const PREVIEW = new Uint8Array([255, 216, 255, 4, 5, 255, 217]);
const ORIGINAL = new Uint8Array([255, 216, 255, 1, 2, 3, 255, 217]);

async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'测试队员'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'队长','fixture','admin',NULL),(2,'队员','fixture','member',1),(3,'普通','fixture','user',NULL); INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,uploader_id) VALUES(1,'已审图','photo','approved','original.jpg','original.jpg','preview.jpg',2),(2,'待审图','photo','pending','pending.jpg','pending.jpg','pending-preview.jpg',2);",
  );
  const files = fakeBucket();
  await files.put("original.jpg", ORIGINAL);
  await files.put("preview.jpg", PREVIEW);
  await files.put("pending.jpg", new Uint8Array([255, 216, 255, 6, 7, 255, 217]));
  await files.put("pending-preview.jpg", new Uint8Array([255, 216, 255, 8, 9, 255, 217]));
  const rawGet = files.get.bind(files);
  files.gets = 0;
  files.get = async (...args) => {
    files.gets++;
    return rawGet(...args);
  };
  globalThis.caches = fakeCaches();
  const env = {
    DB: d1(db),
    FILES: files,
    SESSION_SECRET: "edge-cache-test-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=edge-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (id, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "blackbox_csrf=edge-guest-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (id, path, fields = {}) =>
    req(id, path, {
      method: "POST",
      body: new URLSearchParams({ csrf: id ? "edge-csrf" : "edge-guest-csrf", ...fields }),
    });
  return { db, env, req, post, cache: globalThis.caches };
}

test("approved photo previews are served from the edge cache without a second R2 read", async () => {
  const s = await setup();
  const first = await s.req(0, "/resources/1/preview");
  assert.equal(first.status, 200);
  assert.deepEqual(new Uint8Array(await first.arrayBuffer()), PREVIEW);
  const afterFirst = s.env.FILES.gets;
  assert.ok(afterFirst >= 1);
  const second = await s.req(0, "/resources/1/preview");
  assert.equal(second.status, 200);
  assert.deepEqual(new Uint8Array(await second.arrayBuffer()), PREVIEW);
  assert.equal(s.env.FILES.gets, afterFirst, "second view must not touch R2 body");
});

test("cached bytes never bypass authorization, pending visibility or revocation", async () => {
  const s = await setup();
  assert.equal((await s.req(0, "/resources/1/preview")).status, 200);
  assert.equal((await s.req(0, "/resources/2/preview")).status, 403);
  const owner = await s.req(2, "/resources/2/preview");
  assert.equal(owner.status, 200);
  assert.deepEqual(new Uint8Array(await owner.arrayBuffer()), new Uint8Array([255, 216, 255, 8, 9, 255, 217]));
  s.db.exec("UPDATE resource SET status='pending' WHERE id=1");
  assert.equal((await s.req(0, "/resources/1/preview")).status, 403, "revocation must not be masked by cache");
});

test("theme stylesheet is shared from the edge cache and skips repeat settings reads", async () => {
  const s = await setup();
  const first = await s.req(0, "/site/theme.css");
  assert.equal(first.status, 200);
  assert.match(await first.text(), /--brand:#ffb547/);
  const afterFirst = s.env.DB.calls;
  const second = await s.req(0, "/site/theme.css");
  assert.equal(second.status, 200);
  assert.equal(s.env.DB.calls, afterFirst, "cached stylesheet must not query D1 again");
  assert.match(second.headers.get("cache-control") || "", /no-cache/);
  assert.match(second.headers.get("cache-control") || "", /private/);
  assert.doesNotMatch(second.headers.get("cache-control") || "", /s-maxage/);
});

test("hiding a work denies already-warmed public image caches before HEAD or 304", async () => {
  const s = await setup();
  try {
    s.db.exec(
      "INSERT INTO production(id,title,cover_id) VALUES(1,'cache work',1); UPDATE resource SET production_id=1 WHERE id=1; UPDATE site_profile SET featured_production_id=1 WHERE id=1",
    );
    for (const path of ["/resources/1/preview", "/productions/1/cover", "/site/featured-cover"])
      assert.equal((await s.req(0, path)).status, 200);
    assert.ok(s.cache.store.size);
    assert.equal((await s.post(1, "/admin/productions/1/visibility", { is_hidden: "1" })).status, 303);
    for (const path of ["/resources/1/preview", "/productions/1/cover", "/site/featured-cover"]) {
      for (const method of ["GET", "HEAD"])
        assert.equal(
          (await s.req(2, path, { method, headers: { "If-None-Match": "*", Range: "bytes=0-1" } })).status,
          404,
        );
      assert.equal((await s.req(1, path)).status, 200);
    }
    assert.equal((await s.post(1, "/admin/productions/1/visibility", { is_hidden: "0" })).status, 303);
    assert.equal((await s.req(0, "/resources/1/preview")).status, 200);
  } finally {
    s.db.close();
  }
});

test("admin settings saves invalidate the cached settings row", async () => {
  const s = await setup();
  assert.match(await (await s.req(0, "/site/theme.css")).text(), /--brand:#ffb547/);
  assert.equal((await s.post(1, "/admin/site", { brand_accent: "#336699" })).status, 303);
  assert.match(await (await s.req(0, "/site/theme.css")).text(), /--brand:#336699/);
});
