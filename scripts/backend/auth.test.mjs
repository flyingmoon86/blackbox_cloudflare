import assert from "node:assert/strict";
import test from "node:test";
import { scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createDatabase, d1, loadModule, loadWorker, fakeBucket, context } from "./harness.mjs";

const worker = await loadWorker();
const { safeNext } = await loadModule("src/http/validation.ts");
const { consumeAuthLimit, cleanExpiredRequestLimits } = await loadModule("src/middleware/request-limits.ts");
const { createSession } = await loadModule("src/auth/session.ts");
const { verifyPassword, hashPassword } = await loadModule("src/auth/password.ts");
const password = "historic-test-password";
// Independent Werkzeug-compatible fixture, with the historical production cost parameters.
const historicHash = `scrypt:32768:8:1$fixed-test-salt$${scryptSync(password, "fixed-test-salt", 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString("hex")}`;

function setup() {
  const db = createDatabase();
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "test-only-session-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const request = (path, options = {}) =>
    worker.fetch(new Request(`https://blackbox.test${path}`, options), env, context());
  const post = (path, values, extra = {}) =>
    request(path, {
      method: "POST",
      headers: { Cookie: "blackbox_csrf=fixture-csrf", "CF-Connecting-IP": "192.0.2.1", ...extra },
      body: new URLSearchParams({ csrf: "fixture-csrf", ...values }),
    });
  return { db, env, request, post };
}

test("safeNext keeps same-site paths and rejects origin/encoding tricks", () => {
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/%5cevil.test",
    "/%2fevil.test",
    "/%0d%0aLocation:evil",
    "/\t/evil.test",
    "/bad%xx",
    "javascript:alert(1)",
    "/".repeat(3000),
  ])
    assert.equal(safeNext(value), "/", value);
  assert.equal(safeNext("/productions/990021?from=home#photos"), "/productions/990021?from=home#photos");
  assert.equal(safeNext("/resources?q=%E8%AF%9D%E5%89%A7"), "/resources?q=%E8%AF%9D%E5%89%A7");
});

test("old scrypt hashes remain valid and new hashes retain their cost", () => {
  assert.equal(verifyPassword(historicHash, password), true);
  assert.equal(verifyPassword(historicHash, "wrong"), false);
  const hash = hashPassword("new-test-password");
  assert.match(hash, /^scrypt:32768:8:1\$/);
  assert.equal(verifyPassword(hash, "new-test-password"), true);
});

test("login validates CSRF and input length before querying or hashing", async () => {
  const { db, env, post, request } = setup();
  const rejected = await post("/login", { username: "nobody", password: "x".repeat(129) });
  assert.equal(rejected.status, 401);
  assert.equal(env.DB.calls, 0);
  const csrf = await request("/login", {
    method: "POST",
    body: new URLSearchParams({ username: "nobody", password: "valid-password" }),
  });
  assert.equal(csrf.status, 400);
  assert.equal(env.DB.calls, 0);
  const large = await request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "1", Accept: "application/json" },
    body: "password=" + "x".repeat(17000),
  });
  assert.equal(large.status, 413);
  const error = await large.json();
  assert.equal(error.code, "PAYLOAD_TOO_LARGE");
  assert.equal(error.requestId, large.headers.get("X-Request-Id"));
  assert.equal(env.DB.calls, 0);
  db.close();
});

test("auth counters survive different Worker requests and reject concurrent excess", async () => {
  const { db, env } = setup();
  const c = () => ({ env, req: { header: () => "192.0.2.10" }, get: () => null });
  const outcomes = await Promise.all(Array.from({ length: 13 }, () => consumeAuthLimit(c(), "login", "SameName")));
  assert.equal(outcomes.filter((x) => x === 0).length, 12);
  assert.ok(outcomes.find((x) => x > 0) <= 900);
  assert.ok((await consumeAuthLimit(c(), "login", "samename")) > 0);
  assert.equal(await consumeAuthLimit(c(), "login", "different-member"), 0);
  const rows = db.prepare("SELECT * FROM request_limit").all();
  assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.key)));
  assert.ok(!JSON.stringify(rows).includes("192.0.2.10"));
  db.close();
});

test("registration allowance supports thirty members on one network", async () => {
  const { db, env } = setup();
  const c = { env, req: { header: () => "192.0.2.12" }, get: () => null };
  for (let index = 0; index < 60; index++) assert.equal(await consumeAuthLimit(c, "register"), 0);
  assert.ok((await consumeAuthLimit(c, "register")) > 0);
  db.close();
});

test("expired counters are reclaimed in bounded batches, live entries remain", async () => {
  const { db, env } = setup();
  const insert = db.prepare("INSERT INTO request_limit(key,hits,expires_at) VALUES(?,1,?)");
  for (let index = 0; index < 250; index++) insert.run(`old-${index}`, 1);
  insert.run("live", Math.floor(Date.now() / 1000) + 3600);
  await cleanExpiredRequestLimits(env);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM request_limit").get().n, 51);
  assert.ok(db.prepare("SELECT key FROM request_limit WHERE key='live'").get());
  await cleanExpiredRequestLimits(env);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM request_limit").get().n, 1);
  db.close();
});

test("login returns retry timing rather than performing unlimited password checks", async () => {
  const { db, post } = setup();
  for (let index = 0; index < 12; index++)
    assert.equal((await post("/login", { username: "unknown", password: "wrong-password" })).status, 401);
  const response = await post("/login", { username: "unknown", password: "wrong-password" });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get("Retry-After")) > 0);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
  db.close();
});

test("successful legacy login cannot redirect off-site; account changes invalidate old sessions", async () => {
  const { db, env, post, request } = setup();
  db.prepare("INSERT INTO member(id,name) VALUES(1,'测试队员')").run();
  db.prepare(
    "INSERT INTO user(id,username,password_hash,role,status,member_id) VALUES(1,'existing',?,'member','active',1)",
  ).run(historicHash);
  const loggedIn = await post("/login", { username: "existing", password, next: "/\\evil.test" });
  assert.equal(loggedIn.status, 303);
  assert.equal(loggedIn.headers.get("Location"), "/");
  const cookie = `blackbox_session=${await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET)}`;
  assert.equal((await request("/profile", { headers: { Cookie: cookie } })).status, 200);
  db.prepare("UPDATE user SET status='disabled' WHERE id=1").run();
  assert.equal((await request("/profile", { headers: { Cookie: cookie } })).status, 302);
  db.prepare("UPDATE user SET status='active',member_id=NULL,role='user',auth_version=1 WHERE id=1").run();
  assert.equal((await request("/profile", { headers: { Cookie: cookie } })).status, 302);
  db.close();
});

test("changing a password invalidates the previously signed cookie", async () => {
  const { db, env, post, request } = setup();
  db.prepare("INSERT INTO user(id,username,password_hash) VALUES(1,'existing',?)").run(historicHash);
  const cookie = `blackbox_session=${await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET)}; blackbox_csrf=fixture-csrf`;
  const response = await post(
    "/profile/password",
    { current_password: password, new_password: "replacement-password", confirm_password: "replacement-password" },
    { Cookie: cookie },
  );
  assert.equal(response.status, 303);
  const account = db.prepare("SELECT password_hash,auth_version FROM user WHERE id=1").get();
  assert.equal(account.auth_version, 1);
  assert.equal(verifyPassword(account.password_hash, "replacement-password"), true);
  assert.equal((await request("/profile", { headers: { Cookie: cookie } })).status, 302);
  db.close();
});

test("dynamic pages/JSON/errors are not cached and API errors retain existing text", async () => {
  const { db, request } = setup();
  for (const path of ["/login", "/health", "/productions", "/api/uploads/missing"]) {
    const response = await request(path);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.ok(response.headers.get("X-Request-Id"));
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    if (path.startsWith("/api/")) {
      const payload = await response.json();
      assert.equal(payload.code, "AUTH_REQUIRED");
      assert.ok(payload.error);
      assert.equal(payload.requestId, response.headers.get("X-Request-Id"));
    }
  }
  db.close();
});

test("registration reports database outage as 500 without leaking exception details", async () => {
  const { db, env, post } = setup();
  const original = env.DB.prepare.bind(env.DB);
  env.DB.prepare = (sql) =>
    sql.includes("INSERT INTO user")
      ? {
          bind: () => ({
            run: async () => {
              throw Error("private-db-detail test-only-password");
            },
          }),
        }
      : original(sql);
  const lines = [];
  const oldLogger = console.error;
  console.error = (value) => lines.push(String(value));
  try {
    const response = await post(
      "/register",
      { username: "fresh", password: "test-only-password", confirm_password: "test-only-password" },
      { Accept: "application/json" },
    );
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.code, "INTERNAL_ERROR");
    assert.ok(payload.requestId);
    assert.ok(!JSON.stringify({ payload, lines }).includes("private-db-detail"));
    assert.ok(!JSON.stringify({ payload, lines }).includes("test-only-password"));
  } finally {
    console.error = oldLogger;
    db.close();
  }
});

test("public asset routing and independent security headers are configured", () => {
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  assert.equal(config.assets.run_worker_first, false);
  const headers = readFileSync("public/_headers", "utf8");
  for (const value of [
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Content-Security-Policy:",
    "Cache-Control: public, max-age=0, must-revalidate",
  ])
    assert.ok(headers.includes(value));
});
