import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
test("homepage previews use approved photos belonging to the linked production only", async () => {
  const db = createDatabase();
  try {
    db.exec(`INSERT INTO production(id,title,year,is_hidden) VALUES(1,'甲作品',2026,0),(2,'乙作品',2025,0),(3,'无剧照作品',2024,0),(4,'隐藏作品',2027,1);
      INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,production_id) VALUES
      (10,'甲剧照','photo','approved','a.jpg','a.jpg','a-preview.jpg',1),
      (11,'乙剧照','photo','approved','b.jpg','b.jpg','b-preview.jpg',2),
      (12,'待审照片','photo','pending','p.jpg','p.jpg','p-preview.jpg',1),
      (13,'其他资料','other','approved','o.jpg','o.jpg','o-preview.jpg',1),
      (14,'未关联照片','photo','approved','x.jpg','x.jpg','x-preview.jpg',NULL),
      (15,'隐藏剧照','photo','approved','h.jpg','h.jpg','h-preview.jpg',4);`);
    const env = {
      DB: d1(db),
      FILES: fakeBucket(),
      SESSION_SECRET: "recommendation-test",
      ENVIRONMENT: "development",
      ASSETS: { fetch: async () => new Response("", { status: 404 }) },
    };
    const response = await worker.fetch(new Request("https://blackbox.test/"), env, context());
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(
      html,
      /href="\/productions\/1" class="playbill-recommendation"><img[^>]*src="\/resources\/10\/preview"/,
    );
    assert.match(
      html,
      /href="\/productions\/2" class="playbill-recommendation"><img[^>]*src="\/resources\/11\/preview"/,
    );
    assert.doesNotMatch(html, /class="recommendation-still"[^>]*src="\/resources\/(12|13|14|15)\/preview"/);
    assert.doesNotMatch(html, /0[123] \/ (BLACK BOX|RECENT|OUR)|>0[123] (入场|作品|剧团)/);
    assert.doesNotMatch(html, /无剧照作品|隐藏作品/);
  } finally {
    db.close();
  }
});
