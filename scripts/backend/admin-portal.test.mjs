import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { hashPassword } = await loadModule("src/auth/password.ts");
async function setup() {
  const db = createDatabase();
  db.prepare("INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin',?,'admin'),(2,'visitor',?,'user')").run(
    hashPassword("portal-test-password"),
    hashPassword("portal-test-password"),
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "portal-test-secret",
    ENVIRONMENT: "production",
    ADMIN_ORIGIN: "https://admin.blackbox.test",
    PUBLIC_ORIGIN: "https://blackbox.test",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2])
    cookies[id] =
      "blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET)) +
      "; blackbox_csrf=portal-csrf";
  const req = (path, id = 0, options = {}, origin = env.ADMIN_ORIGIN) =>
    worker.fetch(
      new Request(origin + path, {
        ...options,
        headers: { Cookie: cookies[id] || "blackbox_csrf=portal-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (path, fields, id = 0, headers = {}) =>
    req(path, id, { method: "POST", headers, body: new URLSearchParams({ csrf: "portal-csrf", ...fields }) });
  return { db, env, req, post };
}
test("portal is private, public admin links redirect and normal site stays public", async () => {
  const s = await setup();
  assert.equal((await s.req("/")).headers.get("location"), "/login?next=%2Fadmin");
  assert.equal((await s.req("/productions")).status, 302);
  assert.equal((await s.req("/admin", 2)).status, 403);
  assert.equal(
    (await s.req("/admin/site?tab=1", 0, {}, s.env.PUBLIC_ORIGIN)).headers.get("location"),
    s.env.ADMIN_ORIGIN + "/admin/site?tab=1",
  );
  assert.equal((await s.req("/productions", 0, {}, s.env.PUBLIC_ORIGIN)).status, 200);
  assert.equal((await s.req("/admin", 0, {}, "https://other.test")).status, 302);
  assert.equal((await s.post("/admin/site", {})).status, 401);
  const html = await (await s.req("/admin", 1)).text();
  assert.match(html, /工作台/);
  assert.match(html, /查看正式网站/);
  assert.match(html, /admin-account-panel/);
  const login = await (await s.req("/login")).text();
  assert.match(login, /后台登录/);
  assert.ok(!login.includes('href="/register"'));
});
test("portal login accepts only active admins and keeps host-only secure sessions", async () => {
  const s = await setup();
  const denied = await s.post("/login", { username: "visitor", password: "portal-test-password" });
  assert.equal(denied.status, 403);
  assert.ok(!(denied.headers.get("set-cookie") || "").includes("blackbox_session="));
  const accepted = await s.post("/login", {
    username: "admin",
    password: "portal-test-password",
    next: "/admin/resources",
  });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/admin/resources");
  const cookie = accepted.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.ok(!/Domain=/i.test(cookie));
  assert.equal((await s.post("/admin/site", {}, 1, { Origin: s.env.PUBLIC_ORIGIN })).status, 403);
  s.db.exec("UPDATE user SET role='user',auth_version=auth_version+1 WHERE id=1");
  assert.equal((await s.req("/admin", 1)).status, 302);
});
