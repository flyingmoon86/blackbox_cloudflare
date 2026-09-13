import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
test("featured production precedes descending years; members rank by combined flowers; dedication is escaped", async () => {
  const db = createDatabase();
  db.exec(
    "INSERT INTO production(id,title,year) VALUES(1,'旧精选',2020),(2,'新作品',2026),(3,'中间作品',2024);UPDATE site_profile SET featured_production_id=1;INSERT INTO member(id,name,join_year) VALUES(1,'新队员',2026),(2,'受欢迎队员',2020);",
  );
  db.prepare("INSERT INTO visitor_flower(visitor_key,member_id,sent_on) VALUES('test-visitor',2,'2026-09-13')").run();
  db.prepare("UPDATE site_profile SET page_texts=?").run(
    JSON.stringify({ special_thanks: "谢谢每一位伙伴\n<script>alert(1)</script>" }),
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "fixture",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const get = async (path) => (await worker.fetch(new Request("https://blackbox.test" + path), env, context())).text();
  const productions = await get("/productions");
  assert.ok(productions.indexOf("旧精选") < productions.indexOf("新作品"));
  assert.ok(productions.indexOf("新作品") < productions.indexOf("中间作品"));
  const members = await get("/members");
  assert.ok(members.indexOf("受欢迎队员") < members.indexOf("新队员"));
  const thanks = await get("/thanks");
  assert.match(thanks, /&lt;script&gt;/);
  assert.doesNotMatch(thanks, /<script>alert/);
  assert.ok(thanks.indexOf("特别致谢") < thanks.indexOf('class="thanks-grid"'));
  const before = env.DB.calls;
  await get("/site/theme.css");
  assert.equal(env.DB.calls - before, 1);
  db.close();
});
