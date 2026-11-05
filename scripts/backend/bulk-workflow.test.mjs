import assert from "node:assert/strict";
import test from "node:test";
import { creditFixture } from "./credit-import-fixture.mjs";

test("review filters search all pages by submitter and edition without crossing the admin boundary", async () => {
  const s = await creditFixture();
  try {
    for (let i = 0; i < 26; i++)
      s.db
        .prepare(
          "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename) VALUES(10,30,2,'pending',?,'photo','synthetic.png')",
        )
        .run("资料" + i);
    for (const q of ["队员", "复排版"]) {
      const response = await s.req(1, "/admin/resources/reviews?q=" + encodeURIComponent(q));
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /共 26 条/);
      assert.equal((html.match(/data-review-id=/g) || []).length, 24);
    }
    assert.equal((await s.req(2, "/admin/resources/reviews?q=队员")).status, 403);
    const bad = await s.req(1, "/admin/resources/reviews?q=%25");
    assert.match(await bad.text(), /共 0 条/);
  } finally {
    s.db.close();
  }
});

test("batched browser requests retain CSRF, actor, conflict and audit rules for each item", async () => {
  const s = await creditFixture();
  try {
    s.db.exec(
      "INSERT INTO resource(id,production_id,edition_id,uploader_id,status,title,res_type,filename) VALUES(70,10,30,2,'pending','审核样例','photo','synthetic.png')",
    );
    assert.equal((await s.post(1, "/admin/resources/70/review", { csrf: "bad", decision: "approve" })).status, 400);
    assert.equal((await s.post(2, "/admin/resources/70/review", { decision: "approve" })).status, 403);
    assert.equal((await s.post(1, "/admin/resources/70/review", { decision: "reject", admin_note: "" })).status, 400);
    assert.equal(s.db.prepare("SELECT status FROM resource WHERE id=70").get().status, "pending");
    assert.equal((await s.post(1, "/admin/resources/70/review", { decision: "approve" })).status, 303);
    assert.equal((await s.post(1, "/admin/resources/70/review", { decision: "approve" })).status, 409);
    assert.equal(
      s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_type='resource' AND entity_id=70").get().n,
      1,
    );
  } finally {
    s.db.close();
  }
});

test("pending review content remains private even though admin cards now link to it", async () => {
  const s = await creditFixture();
  try {
    s.db.exec(
      "INSERT INTO resource(id,production_id,edition_id,uploader_id,status,title,res_type,filename,preview_filename) VALUES(71,10,30,2,'pending','私有待审','photo','original.png','preview.jpg')",
    );
    await s.env.FILES.put("preview.jpg", new Uint8Array([255, 216, 255, 217]));
    assert.equal((await s.req(1, "/resources/71/preview")).status, 200);
    assert.equal((await s.req(2, "/resources/71/preview")).status, 200);
    assert.equal((await s.req(3, "/resources/71/preview")).status, 403);
    assert.equal((await s.req(0, "/resources/71/preview")).status, 403);
    assert.equal(
      (await s.req(3, "/resources/71/preview", { method: "HEAD", headers: { Range: "bytes=0-1" } })).status,
      403,
    );
  } finally {
    s.db.close();
  }
});
