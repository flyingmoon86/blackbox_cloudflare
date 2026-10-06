import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
test("member portrait detail and enlargement use originals while cards keep previews", async () => {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name,photo,avatar_preview) VALUES(1,'头像清晰度测试','member-avatars/1/original.png','member-avatars/1/preview.jpg');",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "portrait-test-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  await env.FILES.put("member-avatars/1/original.png", Buffer.from("original-png-bytes"));
  await env.FILES.put("member-avatars/1/preview.jpg", Buffer.from("thumbnail-jpg"));
  const req = (path, init = {}) => worker.fetch(new Request("https://portrait.test" + path, init), env, context());
  try {
    const thumb = await req("/members/1/avatar");
    assert.equal(await thumb.text(), "thumbnail-jpg");
    const full = await req("/members/1/avatar?size=original");
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("Content-Type"), "image/png");
    assert.equal(await full.text(), "original-png-bytes");
    assert.notEqual(full.headers.get("ETag"), thumb.headers.get("ETag"));
    const detail = await (await req("/members/1")).text();
    assert.match(detail, /href="\/members\/1\/avatar\?size=original" data-dossier-photo/);
    assert.match(detail, /src="\/members\/1\/avatar\?size=original"[^>]*fetchpriority="high"/);
    const list = await (await req("/members")).text();
    assert.match(list, /class="member-card-media" src="\/members\/1\/avatar"/);
    const head = await req("/members/1/avatar?size=original", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("Content-Length"), "18");
    assert.equal(await head.text(), "");
    const range = await req("/members/1/avatar?size=original", { headers: { Range: "bytes=0-7" } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), "original");
    assert.equal(
      (await req("/members/1/avatar?size=original", { headers: { "If-None-Match": full.headers.get("ETag") } })).status,
      304,
    );
    db.exec("UPDATE member SET avatar_preview='' WHERE id=1");
    assert.equal(await (await req("/members/1/avatar")).text(), "original-png-bytes");
    db.exec("UPDATE member SET photo='',avatar_preview='member-avatars/1/preview.jpg' WHERE id=1");
    assert.equal((await req("/members/1/avatar?size=original")).status, 404);
    assert.equal((await req("/members/999/avatar?size=original")).status, 404);
  } finally {
    db.close();
  }
});
