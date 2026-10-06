import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadModule, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");

async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'pagination-admin','fixture','admin'),(2,'pagination-member','fixture','member'); INSERT INTO production(id,title,year) VALUES(1,'分页作品',2026)",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "pagination-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const request = async (path, uid = 1, fields, accept) => {
    const token = await createSession(
      { uid, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
      env.SESSION_SECRET,
    );
    return worker.fetch(
      new Request("https://blackbox.test" + path, {
        method: fields ? "POST" : "GET",
        headers: {
          Cookie: "blackbox_csrf=pagination-csrf; blackbox_session=" + token,
          ...(accept ? { Accept: accept } : {}),
        },
        ...(fields ? { body: new URLSearchParams({ csrf: "pagination-csrf", ...fields }) } : {}),
      }),
      env,
      context(),
    );
  };
  return { db, request };
}

test("admin resource pagination reaches records older than 300 and keeps literal search/year/status filters", async () => {
  const s = await setup();
  const insert = s.db.prepare(
    "INSERT INTO resource(id,production_id,edition_id,title,status,filename,res_type) VALUES(?,1,1,?,? ,?,'script')",
  );
  for (let id = 1; id <= 320; id++)
    insert.run(id, id === 1 ? "old%_archive" : `资料-${id}`, id === 1 ? "pending" : "approved", `${id}.pdf`);
  const first = await (await s.request("/admin/resources")).text();
  assert.equal((first.match(/<h2><a href="\/resources\//g) || []).length, 24);
  assert.doesNotMatch(first, /old%_archive/);
  const last = await (await s.request("/admin/resources?page=999999")).text();
  assert.match(last, /old%_archive/);
  assert.match(last, /第 14 \/ 14 页/);
  const filter = await (await s.request("/admin/resources?year=2026&status=pending&q=%25_")).text();
  assert.match(filter, /old%_archive/);
  assert.match(filter, /共 1 条/);
  assert.doesNotMatch(filter, /<h2><a[^>]+>资料-/);
  assert.match(await (await s.request("/admin/resources?q=%22%3E%3Cscript%3E")).text(), /&lt;script&gt;/);
  for (const path of ["/admin/resources?page=14", "/admin/resources/reviews", "/admin/community", "/admin/suggestions"])
    assert.equal((await s.request(path, 2)).status, 403);
  s.db.close();
});

test("server-paged review remains AJAX-compatible and rejects external return destinations", async () => {
  const s = await setup();
  s.db.exec(
    "INSERT INTO resource(id,title,status,filename) VALUES(1,'pending-1','pending','1.pdf'),(2,'pending-2','pending','2.pdf')",
  );
  const response = await s.request(
    "/admin/resources/1/review",
    1,
    { decision: "approve", return_to: "/admin/resources/reviews?page=2&q=test" },
    "application/json",
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reviewed: true });
  const rejected = await s.request("/admin/resources/2/review", 1, {
    decision: "approve",
    return_to: "https://outside.invalid/",
  });
  assert.equal(rejected.status, 303);
  assert.equal(rejected.headers.get("Location"), "/admin/resources/reviews");
  s.db.close();
});

test("feedback and contributors have independent server pages and submissions retain filters", async () => {
  const s = await setup();
  for (let id = 1; id <= 35; id++)
    s.db
      .prepare(
        "INSERT INTO website_feedback(request_key,identity_key,display_name,public_consent,content) VALUES(?,?,?,0,?)",
      )
      .run(`req-${id}`, `visitor-${id}`, `反馈人-${id}`, `反馈正文-${id}`);
  for (let id = 1; id <= 60; id++)
    s.db
      .prepare("INSERT INTO site_contributor(identity_key,display_name,public_consent) VALUES(?,?,1)")
      .run(`person-${id}`, `贡献人-${id}`);
  for (let id = 1; id <= 30; id++)
    s.db.prepare("INSERT INTO suggestion(user_id,content) VALUES(1,?)").run(`建档-${id}`);
  const html = await (await s.request("/admin/community?feedback_page=3&contributors_page=3")).text();
  assert.match(html, /反馈正文-1</);
  assert.doesNotMatch(html, /反馈正文-35</);
  assert.match(html, /贡献人-1 ·/);
  assert.doesNotMatch(html, /贡献人-60 ·/);
  assert.match(html, /feedback_page=2&amp;contributors_page=3/);
  assert.doesNotMatch(html, /data-paginate=/);
  const result = await s.request("/admin/community", 1, {
    action: "resolve",
    id: "1",
    return_to: "/admin/community?status=open&feedback_page=3&contributors_page=2",
  });
  assert.equal(result.headers.get("Location"), "/admin/community?status=open&feedback_page=3&contributors_page=2");
  const suggestions = await (await s.request("/admin/suggestions?page=3")).text();
  assert.match(suggestions, /建档-1</);
  assert.doesNotMatch(suggestions, /建档-30</);
  s.db.close();
});
