import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
test("theatre redesign renders three real scenes, safe titles, and preserves native login and public routes", async () => {
  const db = createDatabase();
  db.prepare(
    "INSERT INTO production(id,title,year,promo,synopsis) VALUES(700,'<script>舞台</script>',2026,'演出介绍','正文'),(701,'旧作品',2020,'','')",
  ).run();
  db.prepare("UPDATE site_profile SET featured_production_id=700 WHERE id=1").run();
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "design-test-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const req = (path) => worker.fetch(new Request("http://localhost" + path), env, context());
  const home = await req("/");
  assert.equal(home.status, 200);
  const html = await home.text();
  for (const id of ["welcome", "about", "playbill"]) assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /&lt;script&gt;舞台&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>舞台/);
  assert.match(html, /href="\/productions\/701"/);
  assert.match(html, /design-public/);
  const login = await (await req("/login?next=%2Fresources")).text();
  assert.match(login, /检票入场/);
  assert.match(login, /method="post" action="\/login"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.match(login, /name="next" value="\/resources"/);
  for (const path of ["/productions", "/members", "/resources", "/thanks"])
    assert.equal((await req(path)).status, 200, path);
  assert.equal((await req("/admin")).status, 302);
  assert.equal((await req("/help")).headers.get("Location"), "/thanks");
  db.prepare("UPDATE site_profile SET featured_production_id=NULL WHERE id=1").run();
  const noFeature = await (await req("/")).text();
  assert.match(noFeature, /id="playbill"/);
  assert.doesNotMatch(noFeature, /class="playbill-feature"/);
  db.close();
});
