import assert from "node:assert/strict";
import test from "node:test";
import { visibilityFixture } from "./visibility-fixture.mjs";

test("strict work preview authorizes public approved matching covers before HEAD, Range or 304", async () => {
  const s = await visibilityFixture();
  const reads = [];
  for (const method of ["head", "get"]) {
    const original = s.env.FILES[method].bind(s.env.FILES);
    s.env.FILES[method] = (key, ...args) => {
      reads.push(key);
      return original(key, ...args);
    };
  }
  const url = "/productions/1/cover?size=preview&previewOnly=1&v=1";
  try {
    const editorDetail = await (await s.req(1, "/productions/1?stage-preview=1")).text();
    assert.match(editorDetail, /work-browse\.[a-f\d]+\.css/);
    assert.doesNotMatch(editorDetail, /work-browse\.[a-f\d]+\.js/);
    for (const user of [0, 1, 2, 3]) {
      const response = await s.req(user, url);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "public-preview.jpg");
      assert.match(response.headers.get("cache-control"), /private, no-cache/);
      const etag = response.headers.get("etag");
      assert.equal((await s.req(user, url, { headers: { "If-None-Match": etag } })).status, 304);
      const head = await s.req(user, url, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), "");
      const range = await s.req(user, url, { headers: { Range: "bytes=0-2" } });
      assert.equal(range.status, 206);
      assert.equal(await range.text(), "pub");
      assert.equal((await s.req(user, "/productions/1/cover?previewOnly=1")).status, 404);
    }
    assert.ok(reads.length);
    assert.ok(reads.every((key) => key === "public-preview.jpg"));
    reads.length = 0;
    for (const version of ["", "0", "-1", "1.5", "invalid", "9007199254740992", "2"]) {
      for (const user of [0, 1, 2, 3])
        for (const method of ["GET", "HEAD"])
          assert.equal(
            (
              await s.req(user, `/productions/1/cover?size=preview&previewOnly=1&v=${version}`, {
                method,
                headers: { Range: "bytes=0-2", "If-None-Match": "*" },
              })
            ).status,
            404,
            `invalid or stale cover version: ${version}`,
          );
    }
    assert.deepEqual(reads, [], "stale cover versions must not access R2 or return cached bytes");
    for (const mutation of [
      "UPDATE production SET is_hidden=1 WHERE id=1",
      "UPDATE production SET is_hidden=0 WHERE id=1; UPDATE resource SET status='pending' WHERE id=1",
      "UPDATE resource SET status='approved',production_id=2 WHERE id=1",
      "UPDATE resource SET production_id=NULL WHERE id=1",
      "UPDATE resource SET production_id=1,res_type='script' WHERE id=1",
      "UPDATE resource SET res_type='photo',preview_filename='' WHERE id=1",
    ]) {
      s.db.exec(mutation);
      reads.length = 0;
      for (const user of [0, 1, 2, 3])
        for (const method of ["GET", "HEAD"])
          assert.equal(
            (await s.req(user, url, { method, headers: { Range: "bytes=0-2", "If-None-Match": "*" } })).status,
            404,
            `${mutation}: ${user} ${method}`,
          );
      assert.deepEqual(reads, [], "denial must precede storage or cached byte lookup");
    }
    s.db.exec("UPDATE resource SET preview_filename='missing-preview.jpg' WHERE id=1");
    reads.length = 0;
    for (const user of [0, 1, 2, 3]) assert.equal((await s.req(user, url)).status, 404);
    assert.ok(
      reads.every((key) => key === "missing-preview.jpg"),
      "strict mode must never fall back to the original",
    );
    assert.equal(await (await s.req(0, "/productions/1/cover?size=preview")).text(), "public.jpg");
  } finally {
    s.db.close();
  }
});
