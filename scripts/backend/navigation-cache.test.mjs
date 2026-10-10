import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
function fixture() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'navigation-admin','fixture','admin'); INSERT INTO production(id,title,is_hidden) VALUES(1,'PUBLIC_WORK',0),(2,'HIDDEN_WORK',1)",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "navigation-cache-test",
    ENVIRONMENT: "development",
    PUBLIC_ORIGIN: "https://blackbox.test",
    ADMIN_ORIGIN: "https://admin.blackbox.test",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const request = (path, options = {}, origin = env.PUBLIC_ORIGIN) =>
    worker.fetch(new Request(origin + path, options), env, context());
  return { db, env, request };
}
test("only anonymous unfiltered landing pages have short browser-only cache variants", async () => {
  const s = fixture();
  try {
    for (const path of ["/", "/productions", "/resources", "/members", "/thanks"]) {
      for (const method of ["GET", "HEAD"]) {
        const r = await s.request(path, { method });
        assert.equal(r.status, 200, path);
        assert.equal(r.headers.get("Cache-Control"), "private, max-age=20, must-revalidate");
        assert.match(r.headers.get("Vary"), /Cookie/);
        assert.match(r.headers.get("Vary"), /Authorization/);
        assert.equal(r.headers.get("X-Blackbox-Navigation"), "public-v1");
        if (method === "GET") {
          const html = await r.text();
          assert.match(html, /data-navigation-cache="public-v1"/);
          assert.doesNotMatch(html, /HIDDEN_WORK/);
        }
      }
    }
  } finally {
    s.db.close();
  }
});
test("session variants, expired cookies, personal pages, queries, errors and the admin host remain no-store", async () => {
  const s = fixture();
  try {
    const cookie =
      "blackbox_session=" +
      (await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, s.env.SESSION_SECRET));
    for (const options of [
      { headers: { Cookie: cookie } },
      { headers: { Cookie: "blackbox_session=expired" } },
      { headers: { Authorization: "Bearer fixture" } },
    ]) {
      const r = await s.request("/productions", options);
      assert.equal(r.headers.get("Cache-Control"), "private, no-store");
      assert.equal(r.headers.get("X-Blackbox-Navigation"), null);
      assert.match(await r.text(), /data-navigation-cache="none"/);
    }
    const admin = await s.request("/productions", { headers: { Cookie: cookie } });
    assert.match(await admin.text(), /HIDDEN_WORK/);
    for (const path of [
      "/productions?q=x",
      "/members?page=2",
      "/thanks?stage-preview=1",
      "/login",
      "/profile",
      "/feedback",
      "/productions/2",
      "/health",
    ]) {
      const r = await s.request(path);
      assert.equal(r.headers.get("Cache-Control"), "private, no-store", path);
      assert.equal(r.headers.get("X-Blackbox-Navigation"), null, path);
    }
    const portal = await s.request("/", {}, s.env.ADMIN_ORIGIN);
    assert.equal(portal.headers.get("Cache-Control"), "private, no-store");
    assert.equal(portal.headers.get("X-Blackbox-Navigation"), null);
  } finally {
    s.db.close();
  }
});
test("setting a cookie or returning an error overrides the navigation cache allowlist", async () => {
  const { noStore } = await loadModule("src/middleware/security.ts");
  for (const response of [
    new Response("html", { headers: { "Content-Type": "text/html", "Set-Cookie": "new=value" } }),
    new Response("failed", { status: 503, headers: { "Content-Type": "text/html" } }),
  ]) {
    const c = { res: response, header: (name, value) => response.headers.set(name, value) };
    await noStore(c, async () => {});
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Blackbox-Navigation"), null);
  }
});
