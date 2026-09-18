import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();

test("public timeline groups actual edition years, counts distinct people and approved resources, and keeps stable order", async () => {
  const db = createDatabase();
  try {
    db.exec(`INSERT INTO production(id,title,year) VALUES(101,'跨年作品',2020),(102,'同年作品',2026),(103,'<未知>',NULL);
      INSERT INTO production_edition(id,production_id,name,year) VALUES(201,101,'复排',2026),(202,101,'加演',2026);
      INSERT INTO member(id,name) VALUES(1,'演员');
      INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) VALUES(101,201,1,'cast','主角'),(101,202,1,'crew','灯光');
      INSERT INTO resource(id,production_id,edition_id,title,filename,res_type,status,preview_filename) VALUES
      (401,101,201,'剧照','a.jpg','photo','approved','a-preview.jpg'),
      (402,101,201,'待审','b.jpg','photo','pending','b-preview.jpg');`);
    const env = { DB: d1(db), FILES: fakeBucket(), SESSION_SECRET: "timeline-test", ENVIRONMENT: "development" };
    const req = (path) => worker.fetch(new Request("http://localhost" + path), env, context());
    const response = await req("/productions?view=timeline");
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.indexOf('id="year-2026"') < html.indexOf('id="year-2020"'));
    assert.ok(html.indexOf('id="year-2020"') < html.indexOf('id="year-unknown"'));
    assert.ok(html.indexOf('href="/productions/102"') < html.indexOf('href="/productions/101"'));
    assert.equal(html.match(/href="\/productions\/101"/g).length, 2);
    assert.match(html, /2 个版本<\/span><span>1 位演职员<\/span><span>1 份资料/);
    assert.match(html, /\/resources\/401\/preview/);
    assert.doesNotMatch(html, /\/resources\/402\/preview/);
    assert.match(html, /影像待补/);
    assert.match(html, /暂无入库资料/);
    assert.match(html, /&lt;未知&gt;/);
    for (const query of ["view=timeline&year=bad&page=-99", "view=timeline&q=%27%3B", "view=bad&page=abc"]) {
      assert.equal((await req("/productions?" + query)).status, 200);
    }
    db.exec("UPDATE production SET cover_id=401 WHERE id=101");
    assert.match(await (await req("/productions?view=timeline")).text(), /\/productions\/101\/cover\?v=401/);
    db.exec("UPDATE resource SET status='pending' WHERE id=401");
    assert.doesNotMatch(
      await (await req("/productions?view=timeline")).text(),
      /\/cover\?v=401|\/resources\/401\/preview/,
    );
    db.exec("DELETE FROM production");
    assert.match(await (await req("/productions?view=timeline")).text(), /还没有演出记录/);
  } finally {
    db.close();
  }
});
