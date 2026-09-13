import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { reviewRequest } = await loadModule("src/services/reviews.ts");
async function setup() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'甲'),(2,'乙');INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'admin','hash','admin',NULL),(2,'member','hash','member',1),(3,'visitor','hash','user',NULL);INSERT INTO production(id,title,year) VALUES(10,'旧作品',2020),(20,'另一个作品',2024);INSERT INTO production_edition(id,production_id,name,year) VALUES(30,10,'复排版',2026);",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "edition-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=edition-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (id, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "", "x-csrf-token": "edition-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (id, path, fields = {}) => {
    const body = new URLSearchParams({ csrf: "edition-csrf" });
    for (const [key, values] of Object.entries(fields))
      for (const v of Array.isArray(values) ? values : [values]) body.append(key, String(v));
    return req(id, path, { method: "POST", body });
  };
  return { db, env, req, post };
}
test("required resource edition migration preserves keys and assigns only unassigned work files", () => {
  const db = createDatabase(15);
  db.exec(
    "INSERT INTO production(id,title) VALUES(1,'作品');INSERT INTO production_edition(id,production_id,name,year) VALUES(20,1,'新版',2026);INSERT INTO resource(id,title,filename,production_id,edition_id) VALUES(1,'旧图','keep.jpg',1,NULL),(2,'已分版','keep2.jpg',1,20),(3,'其他','other.pdf',NULL,NULL)",
  );
  db.exec(readFileSync("migrations/0016_required_resource_editions.sql", "utf8"));
  assert.equal(db.prepare("SELECT edition_id FROM resource WHERE id=1").get().edition_id, 1);
  assert.equal(db.prepare("SELECT edition_id FROM resource WHERE id=2").get().edition_id, 20);
  assert.equal(db.prepare("SELECT edition_id FROM resource WHERE id=3").get().edition_id, null);
  assert.equal(db.prepare("SELECT filename FROM resource WHERE id=1").get().filename, "keep.jpg");
  db.exec("DELETE FROM production WHERE id=1");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM resource").get().n, 3);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
});

test("batch cast keeps AB roles and is atomic on duplicates", async () => {
  const s = await setup();
  const path = "/admin/productions/10/credits";
  const fields = { edition_id: "30", member_id: ["1", "2"], kind: ["cast", "cast"], role_name: ["主角", "主角"] };
  assert.equal((await s.post(2, path, fields)).status, 403);
  assert.equal((await s.post(1, path, fields)).status, 303);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 2);
  assert.equal((await s.post(1, path, { ...fields, role_name: ["新角色", "主角"] })).status, 409);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 2);
  assert.equal((await s.post(1, path, { ...fields, member_id: ["1", "999"] })).status, 400);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 2);
});

test("admin moves resources within work without changing status or files", async () => {
  const s = await setup();
  s.db.exec(
    "INSERT INTO resource(id,title,filename,res_type,status,production_id) VALUES(1,'版本剧照','keep.jpg','photo','approved',10),(2,'别的作品','other.jpg','photo','pending',20)",
  );
  const path = "/admin/productions/10/move-resources";
  assert.equal((await s.post(2, path, { edition_id: "30", resource_ids: ["1"] })).status, 403);
  assert.equal((await s.post(1, path, { edition_id: "30", resource_ids: ["1", "2"] })).status, 409);
  assert.equal(s.db.prepare("SELECT edition_id FROM resource WHERE id=1").get().edition_id, 1);
  assert.equal((await s.post(1, path, { edition_id: "30", resource_ids: ["1"] })).status, 303);
  const row = s.db.prepare("SELECT edition_id,filename,status FROM resource WHERE id=1").get();
  assert.deepEqual({ ...row }, { edition_id: 30, filename: "keep.jpg", status: "approved" });
  assert.ok(!(await (await s.req(0, "/resources")).text()).includes("版本剧照"));
  const detail = await (await s.req(0, "/productions/10")).text();
  assert.ok(detail.includes("版本剧照"));
  assert.ok(!detail.includes("作品通用资料"));
});

test("edition upgrade preserves identities, pending review and files; deletion keeps resources", async () => {
  const db = createDatabase(14);
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'旧队员');INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'admin','old-hash','admin',NULL),(2,'member','unchanged-hash','member',1);INSERT INTO production(id,title,year) VALUES(70,'旧作品',2018);INSERT INTO production_credit(id,production_id,member_id,kind,role_name) VALUES(80,70,1,'cast','主角');INSERT INTO production_join_request(id,user_id,member_id,production_id,kind,role_name) VALUES(90,2,1,70,'crew','导演');INSERT INTO resource(id,title,filename,production_id) VALUES(100,'旧资料','unchanged/key.jpg',70);",
  );
  db.exec(readFileSync("migrations/0015_production_editions.sql", "utf8"));
  const edition = db.prepare("SELECT * FROM production_edition WHERE production_id=70").get();
  assert.equal(edition.year, 2018);
  assert.equal(db.prepare("SELECT edition_id FROM production_credit WHERE id=80").get().edition_id, edition.id);
  assert.equal(db.prepare("SELECT edition_id FROM production_join_request WHERE id=90").get().edition_id, edition.id);
  await reviewRequest(d1(db), "production-join", 90, 1, "approved");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM production_credit WHERE edition_id=?").get(edition.id).n, 2);
  assert.equal(db.prepare("SELECT password_hash FROM user WHERE id=2").get().password_hash, "unchanged-hash");
  db.prepare("UPDATE resource SET edition_id=? WHERE id=100").run(edition.id);
  db.exec("DELETE FROM production WHERE id=70");
  assert.deepEqual(
    { ...db.prepare("SELECT filename,production_id,edition_id FROM resource WHERE id=100").get() },
    { filename: "unchanged/key.jpg", production_id: null, edition_id: null },
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM production_edition").get().n, 0);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
});
test("multi-edition creation is atomic and lists one work by latest edition", async () => {
  const s = await setup();
  const fields = {
    title: "三个版本",
    edition_name: ["首演版", "巡演版", "校园版"],
    edition_year: ["2021", "2026", "2026"],
  };
  const response = await s.post(1, "/admin/productions/new", fields);
  assert.equal(response.status, 303, await response.clone().text());
  const production = Number(response.headers.get("location").split("/").pop());
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_edition WHERE production_id=?").get(production).n, 3);
  assert.equal(s.db.prepare("SELECT year FROM production WHERE id=?").get(production).year, 2026);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production WHERE title=?").get(fields.title).n, 1);
  const html = await (await s.req(0, "/productions/" + production)).text();
  assert.equal((html.match(/class="production-edition"/g) || []).length, 3);
  assert.ok(html.indexOf("<h2>校园版") < html.indexOf("<h2>首演版"));
  assert.equal(
    (
      await s.post(1, "/admin/productions/new", {
        ...fields,
        edition_name: ["重复", "重复"],
        edition_year: ["2026", "2026"],
      })
    ).status,
    400,
  );
  s.db.exec(
    "CREATE TRIGGER fail_edition BEFORE INSERT ON production_edition WHEN NEW.name='失败版' BEGIN SELECT RAISE(ABORT,'simulated-failure');END;",
  );
  assert.equal(
    (
      await s.post(1, "/admin/productions/new", {
        title: "应回滚",
        edition_name: ["首演", "失败版"],
        edition_year: ["2025", "2026"],
      })
    ).status,
    500,
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production WHERE title='应回滚'").get().n, 0);
});
test("credits, shared cast and reviews are edition scoped; foreign editions and unauthorized changes fail", async () => {
  const s = await setup(),
    initial = s.db.prepare("SELECT id FROM production_edition WHERE production_id=10 ORDER BY id LIMIT 1").get().id;
  for (const edition_id of [initial, 30])
    assert.equal(
      (await s.post(2, "/productions/10/join", { edition_id, kind: "cast", role_name: "主角" })).status,
      303,
    );
  assert.equal(
    (await s.post(2, "/productions/10/join", { edition_id: 30, kind: "cast", role_name: "主角" })).status,
    409,
  );
  for (const { id } of s.db.prepare("SELECT id FROM production_join_request").all())
    await reviewRequest(s.env.DB, "production-join", id, 1, "approved");
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit WHERE member_id=1").get().n, 2);
  assert.equal(
    (
      await s.post(1, "/admin/productions/10/credits", {
        edition_id: 30,
        member_id: 2,
        kind: "cast",
        role_name: "主角",
      })
    ).status,
    303,
  );
  assert.equal(
    (
      await s.post(1, "/admin/productions/10/credits", {
        edition_id: 30,
        member_id: 1,
        kind: "cast",
        role_name: "路人",
      })
    ).status,
    303,
  );
  assert.equal(
    (await s.post(1, "/admin/productions/20/credits", { edition_id: 30, member_id: 1, role_name: "错误" })).status,
    400,
  );
  assert.equal((await s.post(2, "/productions/10/join", { kind: "cast", role_name: "缺少版本" })).status, 400);
  assert.equal((await s.post(3, "/admin/productions/10/editions", { name: "越权", year: 2026 })).status, 403);
  assert.equal((await s.post(1, "/admin/productions/10/editions/30", { name: "修订版", year: 2023 })).status, 303);
  assert.equal(s.db.prepare("SELECT year FROM production WHERE id=10").get().year, 2023);
  s.db.exec("UPDATE production_edition SET year=2018 WHERE id=30");
  assert.equal((await s.post(1, "/admin/productions/10/editions/30", { name: "保留旧年", year: "" })).status, 303);
  assert.equal(s.db.prepare("SELECT year FROM production_edition WHERE id=30").get().year, 2018);
});
test("upload and resource editing enforce edition ownership; unassigned old files remain general", async () => {
  const s = await setup();
  const create = (editionId) =>
    s.req(2, "/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "版本照片",
        resType: "photo",
        productionId: 20,
        editionId,
        originalName: "photo.jpg",
        contentType: "image/jpeg",
        sizeBytes: 32,
      }),
    });
  assert.equal((await create(30)).status, 400);
  assert.equal((await create("invalid")).status, 400);
  const edition = s.db.prepare("SELECT id FROM production_edition WHERE production_id=20").get().id;
  const result = await create(edition);
  assert.equal(result.status, 201, await result.clone().text());
  assert.equal(s.db.prepare("SELECT edition_id FROM upload_task").get().edition_id, edition);
  s.db.exec("INSERT INTO resource(id,title,filename,production_id,edition_id) VALUES(99,'资料','fixture.jpg',10,30)");
  assert.equal(
    (
      await s.post(1, "/admin/resources/99/edit", {
        title: "资料",
        res_type: "photo",
        production_id: 20,
        edition_id: 30,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await s.post(1, "/admin/resources/99/edit", {
        title: "资料",
        res_type: "photo",
        production_id: 20,
        edition_id: edition,
      })
    ).status,
    303,
  );
  assert.equal(s.db.prepare("SELECT edition_id FROM resource WHERE id=99").get().edition_id, edition);
  s.db.exec("UPDATE resource SET production_id=NULL WHERE id=99");
  assert.equal(s.db.prepare("SELECT edition_id FROM resource WHERE id=99").get().edition_id, null);
});
