import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
test("cover list preview preserves full detail image, fallback and access checks", async () => {
  const db = createDatabase();
  db.exec(
    "INSERT INTO production(id,title) VALUES(1,'封面性能测试'); INSERT INTO resource(id,production_id,title,res_type,status,filename,original_name,preview_filename) VALUES(1,1,'封面','photo','approved','original.jpg','original.jpg','preview.png'); UPDATE production SET cover_id=1 WHERE id=1;",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "test-cover-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  await env.FILES.put("original.jpg", Buffer.from("large-original"));
  await env.FILES.put("preview.png", Buffer.from("small"));
  const req = (path, init = {}) => worker.fetch(new Request("https://cover.test" + path, init), env, context());
  try {
    const small = await req("/productions/1/cover?size=preview");
    assert.equal(small.status, 200);
    assert.equal(await small.text(), "small");
    assert.equal(small.headers.get("Content-Type"), "image/png");
    assert.equal(await (await req("/productions/1/cover")).text(), "large-original");
    const head = await req("/productions/1/cover?size=preview", { method: "HEAD" });
    assert.equal(head.headers.get("Content-Length"), "5");
    assert.equal(await head.text(), "");
    assert.equal(
      (await req("/productions/1/cover?size=preview", { headers: { "If-None-Match": small.headers.get("ETag") } }))
        .status,
      304,
    );
    const list = await (await req("/productions")).text();
    assert.match(list, /cover\?size=preview&amp;v=1/);
    assert.match(list, /loading="lazy" decoding="async"/);
    const detail = await (await req("/productions/1")).text();
    assert.match(detail, /data-curtain-src="\/productions\/1\/cover\?v=1"/);
    db.exec("UPDATE production SET is_hidden=1 WHERE id=1");
    assert.equal((await req("/productions/1/cover?size=preview")).status, 404);
    db.exec("UPDATE production SET is_hidden=0 WHERE id=1; UPDATE resource SET status='pending' WHERE id=1");
    assert.equal((await req("/productions/1/cover?size=preview")).status, 404);
    db.exec("UPDATE resource SET status='approved',preview_filename='missing.jpg' WHERE id=1");
    assert.equal(await (await req("/productions/1/cover?size=preview")).text(), "large-original");
    db.exec("UPDATE resource SET preview_filename='' WHERE id=1");
    assert.equal(await (await req("/productions/1/cover?size=preview")).text(), "large-original");
  } finally {
    db.close();
  }
});
