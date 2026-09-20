import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase } from "./harness.mjs";
import { visibilityFixture } from "./visibility-fixture.mjs";

test("visibility migration preserves existing works and indexes public year queries", () => {
  const db = createDatabase(17);
  try {
    db.exec("INSERT INTO production(id,title,year) VALUES(1,'existing',2025)");
    db.exec(readFileSync("migrations/0018_production_visibility.sql", "utf8"));
    assert.equal(db.prepare("SELECT is_hidden FROM production WHERE id=1").get().is_hidden, 0);
    assert.throws(() => db.exec("UPDATE production SET is_hidden=2"), /CHECK/);
    assert.match(
      JSON.stringify(
        db.prepare("EXPLAIN QUERY PLAN SELECT id FROM production WHERE is_hidden=0 ORDER BY year DESC,id DESC").all(),
      ),
      /idx_production_visibility_year/,
    );
  } finally {
    db.close();
  }
});

test("guests, users and the author cannot discover hidden works across public and personal entry points", async () => {
  const s = await visibilityFixture();
  try {
    for (const user of [0, 2, 3]) {
      for (const path of [
        "/",
        "/productions",
        "/productions?q=隐藏",
        "/productions?visibility=hidden",
        "/productions?visibility=all&q=隐藏",
        "/productions?view=timeline",
        "/resources",
        "/resources?q=秘密",
        "/members/1",
        "/members?q=隐藏",
      ]) {
        const res = await s.req(user, path);
        assert.equal(res.status, 200, path);
        assert.doesNotMatch(await res.text(), /隐藏演出|秘密剧本|秘密剧照|隐秘角色|已隐藏/, `${user} ${path}`);
      }
      if (user)
        for (const path of ["/my-resources", "/resources/submit?production_id=2"]) {
          const res = await s.req(user, path);
          assert.equal(res.status, 200);
          assert.doesNotMatch(await res.text(), /隐藏演出|秘密剧本|秘密剧照|秘密待审图/);
        }
      for (const path of [
        "/productions/2",
        "/productions/2/cover",
        "/resources/2",
        "/resources/2/preview",
        "/resources/2/media",
        "/resources/2/download",
        "/resources/3",
        "/resources/4/preview",
      ]) {
        for (const method of ["GET", "HEAD"]) {
          const res = await s.req(user, path, { method, headers: { Range: "bytes=0-2", "If-None-Match": "*" } });
          assert.equal(res.status, 404, `${user} ${method} ${path}`);
          assert.match(res.headers.get("cache-control"), /no-store/);
        }
      }
      for (const path of ["/productions/2/join", "/admin/productions/2/edit", "/admin/productions/2/visibility"]) {
        const res = await s.post(user, path, { is_hidden: "0" });
        assert.ok([302, 403, 404].includes(res.status), path);
      }
      assert.equal((await s.req(user, "/productions/1")).status, 200);
      assert.equal((await s.req(user, "/resources/1/preview")).status, 200);
    }
    assert.equal(s.db.prepare("SELECT is_hidden FROM production WHERE id=2").get().is_hidden, 1);
  } finally {
    s.db.close();
  }
});

test("hidden images cannot leak through featured, background, poster, mascot or theme references", async () => {
  const s = await visibilityFixture();
  try {
    for (const user of [0, 2, 3]) {
      assert.equal(await (await s.req(user, "/site/hero")).text(), "public.jpg");
      for (const path of ["/site/featured-cover", "/site/poster", "/site/poster?variant=mobile", "/site/mascot"])
        assert.equal((await s.req(user, path)).status, 404, path);
      assert.equal((await s.req(user, "/site/background?section=productions")).status, 204);
      assert.doesNotMatch(await (await s.req(user, "/site/theme.css?production=2")).text(), /#aa2233/);
    }
    assert.equal(await (await s.req(1, "/site/featured-cover")).text(), "hidden.jpg");
    assert.match(await (await s.req(1, "/site/theme.css?production=2")).text(), /#aa2233/);
  } finally {
    s.db.close();
  }
});

test("admins filter, edit and idempotently toggle visibility; CSRF and invalid fields cannot change it", async () => {
  const s = await visibilityFixture();
  try {
    for (const path of ["/productions", "/productions/2", "/productions?view=timeline", "/admin/productions/2/edit"]) {
      const res = await s.req(1, path);
      assert.equal(res.status, 200, path);
      assert.match(await res.text(), /已隐藏|隐藏作品/);
    }
    const hidden = await (await s.req(1, "/productions?visibility=hidden")).text();
    assert.match(hidden, /隐藏演出/);
    assert.doesNotMatch(hidden, /公开演出/);
    const visible = await (await s.req(1, "/productions?visibility=public")).text();
    assert.match(visible, /公开演出/);
    assert.doesNotMatch(visible, /隐藏演出/);
    assert.equal((await s.req(1, "/productions?visibility=' OR 1=1--&page=bad")).status, 200);
    for (const fields of [{ is_hidden: "0", csrf: "bad" }, { is_hidden: "true" }, { is_hidden: "-1" }, {}])
      assert.equal((await s.post(1, "/admin/productions/2/visibility", fields)).status, 400);
    assert.equal(
      (
        await s.req(1, "/admin/productions/2/visibility", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
          body: new URLSearchParams({ csrf: "visibility-csrf", is_hidden: "0" }),
        })
      ).status,
      403,
    );
    assert.equal((await s.post(1, "/admin/productions/999/visibility", { is_hidden: "1" })).status, 404);
    const edit = { title: "隐藏演出", promo: "管理员编辑", resource_ids: "2", cover_id: "2" };
    assert.equal((await s.post(1, "/admin/productions/2/edit", edit)).status, 303);
    assert.equal(
      s.db.prepare("SELECT is_hidden FROM production WHERE id=2").get().is_hidden,
      1,
      "old forms preserve visibility",
    );
    for (const value of ["0", "0", "1", "0"]) {
      assert.equal((await s.post(1, "/admin/productions/2/visibility", { is_hidden: value })).status, 303);
      assert.equal((await s.req(0, "/productions/2")).status, value === "1" ? 404 : 200);
      assert.equal((await s.req(2, "/resources/2/preview")).status, value === "1" ? 404 : 200);
    }
    assert.equal((await s.post(3, "/admin/productions/1/edit", { title: "公开演出", is_hidden: "1" })).status, 403);
    assert.equal(s.db.prepare("SELECT is_hidden FROM production WHERE id=1").get().is_hidden, 0);
    assert.equal((await s.post(1, "/admin/productions/new", { title: "新建隐藏作品", is_hidden: "1" })).status, 303);
    assert.equal(s.db.prepare("SELECT is_hidden FROM production WHERE title='新建隐藏作品'").get().is_hidden, 1);
  } finally {
    s.db.close();
  }
});

test("hidden work rejects new uploads and resuming existing author upload tasks", async () => {
  const s = await visibilityFixture();
  try {
    const edition = s.db.prepare("SELECT id FROM production_edition WHERE production_id=2").get().id;
    const upload = {
      title: "试传",
      originalName: "script.pdf",
      contentType: "application/pdf",
      resType: "script",
      sizeBytes: 10,
      productionId: 2,
      editionId: edition,
    };
    const create = (user) =>
      s.req(user, "/api/uploads", {
        method: "POST",
        headers: { "x-csrf-token": "visibility-csrf", "Content-Type": "application/json" },
        body: JSON.stringify(upload),
      });
    assert.equal((await create(2)).status, 404);
    await s.post(1, "/admin/productions/2/visibility", { is_hidden: "0" });
    const created = await create(2);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    await s.post(1, "/admin/productions/2/visibility", { is_hidden: "1" });
    for (const [method, suffix] of [
      ["GET", ""],
      ["POST", "/complete"],
      ["POST", "/parts/1/url"],
      ["PUT", "/preview"],
    ])
      assert.equal(
        (await s.req(2, "/api/uploads/" + id + suffix, { method, headers: { "x-csrf-token": "visibility-csrf" } }))
          .status,
        404,
      );
    assert.equal((await create(1)).status, 201);
    s.db
      .prepare("UPDATE upload_task SET production_id=NULL,edition_id=NULL,resource_id=2,status='completed' WHERE id=?")
      .run(id);
    assert.equal(
      (await s.req(2, "/api/uploads/" + id)).status,
      404,
      "completed file moved into a hidden work stays private",
    );
  } finally {
    s.db.close();
  }
});
