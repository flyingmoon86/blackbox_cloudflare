import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
async function setup() {
  const db = createDatabase();
  db.exec(`INSERT INTO member(id,name) VALUES(10,'测试档案');
    INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'admin','fixture','admin',NULL),(2,'applicant','fixture','user',NULL),(3,'member','fixture','member',10),(4,'deletable','fixture','user',NULL);
    INSERT INTO join_request(id,user_id,apply_type,name,identity_note) VALUES(1,2,'new','新队员','可核实说明');`);
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "workbench-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=test; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (path, id = 1, options = {}) =>
    worker.fetch(
      new Request("http://localhost" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (path, fields = {}, id = 1) =>
    req(path, id, { method: "POST", body: new URLSearchParams({ csrf: "test", ...fields }) });
  return { db, req, post };
}
test("workbench retains all business destinations, native forms, confirmations and scoped navigation", async () => {
  const s = await setup();
  const html = await (await s.req("/admin")).text();
  for (const href of [
    "/admin/member-requests",
    "/admin/production-requests",
    "/admin/resources/reviews",
    "/admin/suggestions",
    "/admin/community",
    "/admin/credit-imports",
    "/admin/review-history",
    "/admin/system",
    "/admin/resources",
    "/admin/site",
    "/admin/accounts",
    "/profile",
  ]) {
    assert.ok(html.includes(`href="${href}"`), href);
    if (!href.startsWith("#")) assert.equal((await s.req(href)).status, 200, href);
  }
  const members = await (await s.req("/admin/member-requests")).text();
  const accounts = await (await s.req("/admin/accounts")).text();
  assert.doesNotMatch(html, /data-account-tools|data-review-queue="member"/);
  assert.doesNotMatch(members, /data-account-tools/);
  assert.doesNotMatch(accounts, /data-review-queue="member"/);
  const content = members + accounts;
  for (const action of [
    "/admin/requests/1/approve",
    "/admin/requests/1/reject",
    "/admin/users/3/toggle",
    "/admin/users/3/unlink-member",
    "/admin/users/4/delete",
  ]) {
    assert.ok(content.includes(`method="post" action="${action}"`), action);
  }
  assert.match(content, /name="confirm_unlink" value="yes" required/);
  assert.match(content, /name="confirm_username" autocomplete="off" required/);
  assert.match(content, /name="admin_note"[^>]*required/);
  assert.doesNotMatch(content, /action="\/admin\/users\/1\/delete"/);
  assert.match(content, /data-review-queue="member"/);
  assert.match(content, /data-account-tools/);
  assert.match(content, /最多显示最近 200 个账号/);
  assert.match(html, /aria-label="后台工作导航"/);
  // Daily actions stay direct; utilities have one canonical entry instead of repeated cards.
  for (const href of [
    "/resources/submit",
    "/admin/system",
    "/admin/review-history",
    "/admin/credit-imports",
    "/admin/site",
  ]) {
    assert.equal(html.split(`href="${href}"`).length - 1, 1, `one entry: ${href}`);
  }
  const sidebar = html.match(/<aside class="workspace-sidebar">([\s\S]*?)<\/aside>/)[1];
  for (const href of ["/productions", "/members", "/announcements", "/my-resources"]) {
    assert.ok(!sidebar.includes(`href="${href}"`), `public entry removed: ${href}`);
    assert.equal((await s.req(href)).status, 200, `business page retained: ${href}`);
  }
  assert.match(sidebar, /查看正式网站/);
  assert.doesNotMatch(html, /wb-quick|wb-tools|dashboard-fill-title/);
  assert.equal((html.match(/data-workbench-total/g) || []).length, 1);
  assert.doesNotMatch(html, /data-pending-alert|wb-records|wb-archive-links|BLACK BOX · BACKSTAGE|FOLLOW THROUGH/);
  assert.match(html, /href="\/admin\/suggestions">历史建议/);
  assert.doesNotMatch(await (await s.req("/", 2)).text(), /class="workspace-sidebar"/);
  assert.equal((await s.req("/admin", 2)).status, 403);
  assert.equal((await s.req("/admin", 0)).status, 302);
  for (const path of ["/admin/member-requests", "/admin/accounts"]) {
    assert.equal((await s.req(path, 2)).status, 403);
    assert.equal((await s.req(path, 0)).status, 302);
  }
  assert.equal(
    (await s.req("/admin?message=approved")).headers.get("Location"),
    "/admin/member-requests?message=approved",
  );
  assert.equal(
    (await s.req("/admin?message=user-updated")).headers.get("Location"),
    "/admin/accounts?message=user-updated",
  );
  s.db.close();
});
test("unchanged review and account endpoints retain CSRF, validation, state changes and empty state", async () => {
  const s = await setup();
  assert.equal((await s.post("/admin/requests/1/approve", { csrf: "wrong" })).status, 400);
  assert.equal((await s.post("/admin/requests/1/reject", { admin_note: "" })).status, 400);
  assert.equal((await s.post("/admin/requests/1/approve", {}, 2)).status, 403);
  assert.equal((await s.post("/admin/requests/1/approve")).status, 303);
  assert.equal(s.db.prepare("SELECT status FROM join_request WHERE id=1").get().status, "approved");
  assert.match(await (await s.req("/admin/member-requests")).text(), /当前没有待审核的队员申请/);
  assert.equal((await s.post("/admin/users/1/toggle")).status, 400);
  assert.equal((await s.post("/admin/users/4/toggle")).status, 303);
  assert.equal(s.db.prepare("SELECT status FROM user WHERE id=4").get().status, "disabled");
  assert.equal((await s.post("/admin/users/4/toggle")).status, 303);
  assert.equal((await s.post("/admin/users/3/unlink-member")).status, 400);
  assert.equal((await s.post("/admin/users/3/unlink-member", { confirm_unlink: "yes" })).status, 303);
  assert.equal(s.db.prepare("SELECT member_id FROM user WHERE id=3").get().member_id, null);
  assert.ok(s.db.prepare("SELECT id FROM member WHERE id=10").get());
  assert.equal((await s.post("/admin/users/4/delete", { confirm_username: "wrong" })).status, 400);
  assert.equal((await s.post("/admin/users/4/delete", { confirm_username: "deletable" })).status, 303);
  assert.equal(s.db.prepare("SELECT id FROM user WHERE id=4").get(), undefined);
  s.db.close();
});
