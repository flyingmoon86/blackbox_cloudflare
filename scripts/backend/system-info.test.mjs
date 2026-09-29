import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadModule, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { readSystemInfo, tablePurposes } = await loadModule("src/services/system-info.ts");
const { systemInfoSnapshot } = await loadModule("src/views/system-info.ts");

async function fixture(portal = false) {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role,status) VALUES(1,'private-admin','private-hash','admin','active'),(2,'private-user','private-hash','user','active'),(3,'private-member','private-hash','member','active'),(4,'disabled-admin','private-hash','admin','disabled')",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "private-session-secret",
    ENVIRONMENT: "development",
    R2_BUCKET_NAME: "test-bucket",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  // This panel batches read-only PRAGMAs; emulate D1 batch result rows.
  env.DB.batch = async (statements) => Promise.all(statements.map((statement) => statement.all()));
  if (portal) Object.assign(env, { ADMIN_ORIGIN: "https://admin.test", PUBLIC_ORIGIN: "https://public.test" });
  const request = async (path, uid = 0, origin = "https://admin.test") => {
    const token = await createSession(
      { uid, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
      env.SESSION_SECRET,
    );
    return worker.fetch(
      new Request(origin + path, { headers: { Cookie: `blackbox_session=${token}; blackbox_csrf=test` } }),
      env,
      context(),
    );
  };
  return { db, env, request };
}

test("system page and data require active admin on both origins and without portal configuration", async () => {
  for (const portal of [true, false]) {
    const s = await fixture(portal);
    for (const origin of ["https://admin.test", "https://public.test"]) {
      for (const uid of [0, 2, 3, 4]) {
        const data = await s.request("/admin/system/data", uid, origin);
        assert.equal(data.status, [0, 4].includes(uid) ? 401 : 403);
        assert.equal(data.headers.get("Cache-Control"), "private, no-store");
        assert.doesNotMatch(await data.text(), /test-bucket|sqlite_schema|private-hash/);
        const page = await s.request("/admin/system", uid, origin);
        assert.ok([302, 403].includes(page.status));
        assert.doesNotMatch(await page.text(), /SYSTEM|sqlite_schema/);
      }
      const data = await s.request("/admin/system/data", 1, origin);
      assert.equal(data.status, 200);
      assert.match(await data.text(), /test-bucket/);
    }
    const page = await s.request("/admin/system", 1);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /正在加载连接状态/);
    s.db.close();
  }
});

test("metadata matches schema and foreign keys, excludes values/defaults and performs no writes or inventory", async () => {
  const s = await fixture();
  s.db.exec(
    `CREATE TABLE extra_table(id INTEGER PRIMARY KEY, marker TEXT DEFAULT 'sensitive-default', parent INTEGER REFERENCES member(id))`,
  );
  s.env.FILES.list = async () => {
    throw Error("must not scan");
  };
  s.env.FILES.get = async () => {
    throw Error("must not read contents");
  };
  const sql = [];
  const prepare = s.env.DB.prepare;
  s.env.DB.prepare = (query) => {
    sql.push(query);
    return prepare(query);
  };
  const before = s.db.prepare("SELECT total_changes() n").get().n;
  const info = await readSystemInfo(s.env);
  assert.equal(info.database.status, "ok");
  assert.equal(info.storage, "ok");
  assert.ok(info.database.tables.every((t) => t.name === "extra_table" || tablePurposes[t.name]));
  const user = info.database.tables.find((t) => t.name === "user");
  assert.ok(user.relations.some((r) => r.from === "member_id" && r.table === "member"));
  const extra = info.database.tables.find((t) => t.name === "extra_table");
  assert.match(extra.purpose, /未确认/);
  assert.equal(extra.columns.length, 3);
  assert.equal(s.db.prepare("SELECT total_changes() n").get().n, before);
  assert.ok(sql.every((q) => /^(SELECT|PRAGMA (table_info|foreign_key_list))/.test(q)));
  const html = systemInfoSnapshot(info);
  assert.match(html, /不可获取/);
  assert.doesNotMatch(html, /sensitive-default|private-admin|private-user|private-hash|private-session-secret/);
  assert.equal(s.env.FILES.writes, 0);
  s.db.close();
});

test("partial query failures, empty results and escaped metadata remain explicit and safe", async () => {
  const s = await fixture();
  const prepare = s.env.DB.prepare;
  s.env.DB.prepare = (sql) =>
    sql.includes("sqlite_schema")
      ? {
          all: async () => {
            throw Error("private-query-error");
          },
        }
      : prepare(sql);
  s.env.FILES.head = async () => {
    throw Error("private-r2-error");
  };
  const failed = systemInfoSnapshot(await readSystemInfo(s.env));
  assert.match(failed, /数据库结构查询失败/);
  assert.match(failed, /实时连接检查：查询失败/);
  assert.match(failed, /尚未完成/);
  assert.doesNotMatch(failed, /private-query-error|private-r2-error/);
  const empty = systemInfoSnapshot({
    ...(await readSystemInfo(s.env)),
    bucket: "<img src=x onerror=alert(1)>",
    database: { status: "ok", tables: [] },
    ledger: { status: "ok", value: null },
  });
  assert.match(empty, /没有可展示的表/);
  assert.match(empty, /暂无应用台账数据/);
  assert.doesNotMatch(empty, /<img/);
  assert.match(empty, /&lt;img/);
  s.db.close();
});

test("system themes have independent URLs, scoped content and admin protection", async () => {
  const s = await fixture(true);
  for (const section of ["architecture", "flows", "database", "storage"]) {
    const path = "/admin/system/" + section;
    const response = await s.request(path, 1);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    const html = await response.text();
    assert.ok(html.includes(`href="${path}" aria-current="page"`));
    assert.equal(html.includes('id="system-scene"'), section === "architecture");
    assert.equal(html.includes('id="system-flows"'), section === "flows");
    assert.equal(html.includes('id="system-live"'), section !== "flows");
    for (const uid of [0, 2, 3, 4]) {
      assert.ok([302, 403].includes((await s.request(path, uid)).status));
      assert.ok([401, 403].includes((await s.request("/admin/system/data?section=" + section, uid)).status));
    }
    const data = await (await s.request("/admin/system/data?section=" + section, 1)).text();
    assert.equal(data.includes('id="system-database"'), section === "database");
    assert.equal(data.includes('id="system-storage"'), section === "storage");
  }
  const flow = await (await s.request("/admin/system/flows?flow=member", 1)).text();
  assert.match(flow, /<h3>队员认证<\/h3>/);
  assert.doesNotMatch(flow, /<h3>资料上传与审核<\/h3>/);
  assert.equal((await s.request("/admin/system/data?section=invalid", 1)).status, 400);
  s.db.close();
});
