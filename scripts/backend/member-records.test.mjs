import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { recordStatistics, csvCell } = await loadModule("src/services/member-records.ts");
const { drainFileCleanup } = await loadModule("src/services/file-cleanup.ts");
async function setup(t) {
  const db = createDatabase();
  t.after(() => db.close());
  db.exec(
    "INSERT INTO member(id,name) VALUES(1,'合成甲'),(2,'合成乙'),(3,'合成缺失'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'合成管理员','fixture','admin',NULL),(2,'合成本人','fixture','member',1),(3,'合成他人','fixture','member',2),(4,'合成普通','fixture','user',NULL); UPDATE storage_budget SET initialized=1",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "synthetic-records-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("not found", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3, 4])
    cookies[id] =
      "blackbox_csrf=fixture; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (path, id = 0, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (path, id, fields = {}, headers = {}) =>
    req(path, id, {
      method: "POST",
      headers,
      body: fields instanceof FormData ? fields : new URLSearchParams({ csrf: "fixture", ...fields }),
    });
  const create = async (member = 1, kind = "destination", fields = {}, user = 2) => {
    const id = crypto.randomUUID();
    // Legacy private moments are seeded as historical data, never created through the new UI/API.
    if (kind === "moment") {
      db.prepare("INSERT INTO member_record(id,member_id,kind,title,updated_by) VALUES(?,?,'moment',?,?)").run(
        id,
        member,
        fields.title || "合成历史记录",
        user,
      );
      return id;
    }
    const r = await post(`/graduation/${member}/save`, user, {
      id,
      version: "0",
      kind,
      graduation_year: "2026",
      knowledge: "provided",
      destination_type: "recommendation",
      graduate: "SYNTHETIC_SECRET_SCHOOL",
      notes: "SYNTHETIC_PRIVATE_NOTE",
      source: "SYNTHETIC_PRIVATE_SOURCE",
      ...fields,
    });
    assert.equal(r.status, 303, await r.text());
    return id;
  };
  const row = (id) => db.prepare("SELECT * FROM member_record WHERE id=?").get(id);
  const action = (id, user, action, version = row(id).version) =>
    post(`/member-records/${row(id).member_id}/${id}/action`, user, { action, version: String(version) });
  const upload = async (
    record,
    user = 2,
    uploadId = crypto.randomUUID(),
    file = new File([new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 255, 217])], "synthetic.jpg", {
      type: "image/jpeg",
    }),
  ) => {
    const form = new FormData();
    form.set("csrf", "fixture");
    form.set("upload_id", uploadId);
    form.set("photo", file);
    return post(`/member-records/1/${record}/photos`, user, form);
  };
  return { db, env, req, post, create, row, action, upload };
}

test("private record gates: guests, ordinary accounts, other members, stale/disabled/forced-reset sessions", async (t) => {
  const f = await setup(t),
    id = await f.create();
  for (const [user, status] of [
    [0, 401],
    [4, 403],
  ])
    for (const path of [
      "/member-records/1",
      "/admin/member-records",
      "/admin/member-records/export",
      `/member-records/1/${id}/history`,
    ]) {
      const r = await f.req(path, user);
      assert.equal(r.status, status);
      assert.doesNotMatch(await r.text(), /SYNTHETIC_SECRET/);
    }
  for (const user of [2, 3]) {
    assert.equal((await f.req("/admin/member-records", user)).status, 403);
    assert.equal((await f.req("/admin/member-records/export", user)).status, 403);
    assert.equal((await f.req(`/member-records/1/${id}/history`, user)).status, 403);
  }
  assert.doesNotMatch(await (await f.req("/member-records/1", 3)).text(), /SYNTHETIC_SECRET|SYNTHETIC_PRIVATE/);
  assert.equal((await f.action(id, 3, "archive")).status, 404);
  assert.equal((await f.post("/member-records/1/save", 3, { id, kind: "destination", version: "1" })).status, 404);
  const own = await f.req("/member-records/1", 2);
  assert.match(await own.text(), /SYNTHETIC_SECRET_SCHOOL/);
  assert.equal(own.headers.get("cache-control"), "private, no-store");
  f.db.exec("UPDATE user SET status='disabled' WHERE id=2");
  assert.equal((await f.req("/member-records/1", 2)).status, 401);
  f.db.exec("UPDATE user SET status='active',auth_version=1 WHERE id=2");
  assert.equal((await f.req("/member-records/1", 2)).status, 401);
  f.db.exec("UPDATE user SET auth_version=0,must_change_password=1 WHERE id=2");
  assert.equal((await f.action(id, 2, "archive")).status, 403);
  assert.equal((await f.req("/member-records/1", 2)).status, 303);
});
test("graduation stays owner/admin-only even with legacy consent; no confirmation workflow is required", async (t) => {
  const f = await setup(t),
    id = await f.create();
  for (const user of [1, 2]) assert.equal((await f.action(id, user, "consent")).status, 403);
  f.db.prepare("UPDATE member_record SET audience='members',consent_by=2,version=version+1 WHERE id=?").run(id);
  for (const path of ["/graduation/1", "/member-records/1"]) {
    const response = await f.req(path, 3);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /SYNTHETIC_SECRET|SYNTHETIC_PRIVATE/);
  }
  assert.equal((await f.action(id, 1, "verify")).status, 400);
  const r = await f.post("/member-records/1/save", 2, {
    id,
    version: String(f.row(id).version),
    kind: "destination",
    graduation_year: "2026",
    knowledge: "provided",
    destination_type: "employment",
    employer: "SYNTHETIC_EMPLOYER",
  });
  assert.equal(r.status, 303);
  assert.equal(f.row(id).verified, 0);
  assert.equal(f.row(id).audience, "admins");
  assert.equal(f.row(id).checked_at, null);
  assert.doesNotMatch(await (await f.req("/member-records/1", 3)).text(), /SYNTHETIC_EMPLOYER/);
});
test("admin lifecycle, stale/duplicate writes, audit immutability, archive recovery and member deletion guard", async (t) => {
  const f = await setup(t),
    id = await f.create();
  assert.equal((await f.action(id, 1, "withdraw")).status, 303);
  assert.equal((await f.action(id, 1, "archive", 1)).status, 409);
  assert.equal((await f.action(id, 1, "archive")).status, 303);
  assert.equal(f.row(id).archived, 1);
  assert.equal((await f.action(id, 2, "restore")).status, 403);
  assert.equal((await f.action(id, 1, "restore")).status, 303);
  assert.equal(f.row(id).verified, 0);
  assert.equal(f.row(id).audience, "admins");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_record_history WHERE record_id=?").get(id).n, 4);
  assert.throws(
    () => f.db.prepare("UPDATE member_record_history SET action='lost' WHERE record_id=?").run(id),
    /HISTORY_IMMUTABLE/,
  );
  assert.equal(
    (await f.post("/member-records/1/save", 2, { id, version: "0", kind: "destination", destination_type: "exam" }))
      .status,
    409,
  );
  assert.equal((await f.post("/admin/members/1/delete", 1, { confirm_name: "合成甲" })).status, 409);
  assert.match(await (await f.req(`/member-records/1/${id}/history`, 1)).text(), /SYNTHETIC_SECRET_SCHOOL/);
});
test("CSRF, origin, invalid years/types and long active fields do not mutate data", async (t) => {
  const f = await setup(t),
    id = await f.create(),
    fields = { id, version: "1", kind: "destination", destination_type: "recommendation" };
  for (const extra of [
    { csrf: "wrong" },
    { graduation_year: "20260" },
    { destination_type: "invalid" },
    { destination_type: "" },
    { graduate: "x".repeat(301) },
  ])
    assert.equal((await f.post("/member-records/1/save", 2, { ...fields, ...extra })).status, 400);
  assert.equal((await f.post("/member-records/1/save", 2, fields, { Origin: "https://other.test" })).status, 403);
  assert.equal(f.row(id).version, 1);
  assert.equal((await f.post("/member-records/1/save", 2, { ...fields, knowledge: "refused" })).status, 303);
  assert.equal(f.row(id).knowledge, "provided", "obsolete client status cannot mark a submitted record refused");
  assert.equal(
    (
      await f.post("/member-records/1/save", 2, {
        id: crypto.randomUUID(),
        version: "0",
        kind: "moment",
        event_date: "2025-02-29",
      })
    ).status,
    400,
  );
});
test("year statistics trust submitted destinations, exclude missing/undecided and ignore legacy verification", async (t) => {
  const f = await setup(t);
  const categories = [
    ["provided", "recommendation", 1],
    ["provided", "exam", 1],
    ["provided", "employment", 0],
    ["provided", "undecided", 1],
    ["unknown", null, 0],
    ["refused", null, 0],
    ["unfilled", null, 0],
  ];
  for (let i = 0; i < categories.length; i++) {
    const [knowledge, type, verified] = categories[i];
    f.db.prepare("INSERT INTO member(id,name) VALUES(?,?)").run(10 + i, "合成统计" + i);
    f.db
      .prepare(
        "INSERT INTO member_record(id,member_id,kind,graduation_year,knowledge,destination_type,verified,updated_by) VALUES(?,?,'destination',2026,?,?,?,1)",
      )
      .run(crypto.randomUUID(), 10 + i, knowledge, type, verified);
  }
  const data = await recordStatistics(f.env.DB, 2026),
    r = data.rows[0];
  assert.equal(r.total, 7);
  assert.equal(r.denominator, 3);
  assert.equal(r.numerator, 1);
  assert.equal(r.unreported, 3);
  assert.equal(r.unknown, 1);
  assert.equal(r.refused, 1);
  assert.equal(r.unfilled, 1);
  assert.equal(data.missing, 3);
  assert.match(await (await f.req("/admin/member-records?year=2026", 1)).text(), /33.3%/);
  await f.create(1, "destination", { graduation_year: "", destination_type: "undecided", graduate: "" });
  assert.match(await (await f.req("/admin/member-records", 1)).text(), /暂无可计算数据/);
  assert.equal((await f.req("/admin/member-records?year=bad", 1)).status, 400);
});
test("CSV is admin-only, no-store, minimal, and formula-safe; public pages/search never expose fields", async (t) => {
  const f = await setup(t);
  await f.create();
  f.db.exec("UPDATE member SET name='=1+2' WHERE id=1");
  const response = await f.req("/admin/member-records/export", 1),
    csv = await response.text();
  assert.equal(response.status, 200);
  assert.match(csv, /'=1\+2/);
  assert.doesNotMatch(csv, /SYNTHETIC_SECRET|SYNTHETIC_PRIVATE/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  for (const s of ["=x", " +x", "\t@x", "\n-x"]) assert.ok(csvCell(s).startsWith("\"'"));
  for (const path of ["/members", "/members/1", "/members?q=SYNTHETIC", "/resources?q=SYNTHETIC", "/"])
    assert.doesNotMatch(await (await f.req(path)).text(), /SYNTHETIC_SECRET_SCHOOL|SYNTHETIC_PRIVATE/);
});

test("short graduation form saves only type-specific answers, preserves legacy fields and needs no review", async (t) => {
  const f = await setup(t);
  const fields = {
    graduate: "合成学校",
    employer: "合成单位",
    supplement: "合成方向",
    notes: "合成补充",
    source: "ignored",
  };
  const allowed = {
    recommendation: ["graduate", "supplement"],
    exam: ["graduate", "supplement"],
    overseas: ["graduate", "supplement"],
    employment: ["employer", "supplement"],
    entrepreneurship: ["employer", "supplement"],
    other: ["notes"],
    undecided: [],
  };
  let member = 20;
  for (const [type, keys] of Object.entries(allowed)) {
    f.db.prepare("INSERT INTO member(id,name) VALUES(?,?)").run(member, "合成去向" + member);
    const id = await f.create(member, "destination", { ...fields, destination_type: type, knowledge: "refused" }, 1);
    const row = f.row(id),
      details = JSON.parse(row.details);
    assert.equal(row.knowledge, "provided");
    for (const [key, value] of Object.entries(fields)) assert.equal(details[key], keys.includes(key) ? value : "");
    member++;
  }
  const stats = await recordStatistics(f.env.DB, 2026);
  assert.equal(stats.rows[0].denominator, 6);
  assert.equal(stats.rows[0].numerator, 1);
  const id = await f.create();
  f.db.prepare("UPDATE member_record SET details=?,version=version+1 WHERE id=?").run(
    JSON.stringify({
      graduate: "旧学校",
      doctoral: "旧博士院校",
      undergraduate: "旧本科",
      source: "旧来源",
      notes: "旧备注",
      employer: "",
      supplement: "",
    }),
    id,
  );
  assert.equal(
    (
      await f.post("/graduation/1/save", 2, {
        id,
        version: String(f.row(id).version),
        kind: "destination",
        destination_type: "employment",
        employer: "新单位",
        graduate: "隐藏的旧学校",
        notes: "隐藏的旧备注",
      })
    ).status,
    303,
  );
  const changed = JSON.parse(f.row(id).details);
  assert.equal(changed.graduate, "");
  assert.equal(changed.notes, "");
  assert.equal(changed.employer, "新单位");
  assert.equal(changed.doctoral, "旧博士院校");
  assert.equal(changed.source, "旧来源");
  assert.equal(changed.undergraduate, "旧本科");
  assert.match(
    f.db.prepare("SELECT snapshot FROM member_record_history WHERE record_id=? AND version=2").get(id).snapshot,
    /旧学校/,
  );
  const html = await (await f.req("/graduation/1", 2)).text();
  assert.doesNotMatch(html, /资料状态|待核实|已核实|不愿提供|name="knowledge"|name="source"|name="undergraduate"/);
  assert.match(html, /name="recommendation_supplement"/);
  assert.match(html, /name="employment_supplement"/);
  assert.equal(
    (
      await f.post("/graduation/1/save", 2, {
        id,
        version: String(f.row(id).version),
        kind: "destination",
        destination_type: "entrepreneurship",
        entrepreneurship_employer: "合成项目",
        entrepreneurship_supplement: "",
        supplement: "不应从专业带入",
        employment_supplement: "不应从岗位带入",
      })
    ).status,
    303,
  );
  assert.equal(JSON.parse(f.row(id).details).supplement, "");
  assert.equal(JSON.parse(f.row(id).details).employer, "合成项目");
  assert.equal((await f.action(id, 1, "verify")).status, 400);
  assert.doesNotMatch(await (await f.req("/admin/graduation/export", 1)).text(), /资料状态|核实状态|最后核对/);
});
test("private photo upload, pending review, idempotency and raw/HEAD/Range/conditional paths authorize before storage", async (t) => {
  const f = await setup(t),
    record = await f.create(1, "moment", { title: "合成入队合照" }),
    uploadId = crypto.randomUUID();
  assert.equal((await f.upload(record, 2, uploadId)).status, 303);
  assert.equal((await f.upload(record, 2, uploadId)).status, 303);
  const photo = f.db.prepare("SELECT * FROM member_record_photo WHERE id=?").get(uploadId);
  assert.equal(photo.status, "pending");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_record_photo").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 0);
  const path = `/member-records/1/${record}/photos/${photo.id}/file`;
  let r = await f.req(path, 2);
  assert.equal(r.status, 200);
  const etag = r.headers.get("etag");
  assert.equal(r.headers.get("cache-control"), "private, no-store");
  for (const user of [0, 3, 4])
    for (const options of [
      {},
      { method: "HEAD" },
      { headers: { Range: "bytes=0-3" } },
      { headers: { "If-None-Match": etag } },
      { headers: { "If-Modified-Since": "Wed, 01 Jan 2099 00:00:00 GMT" } },
      { headers: { Range: "bytes=0-3", "If-Range": etag } },
    ]) {
      const oldHead = f.env.FILES.head;
      f.env.FILES.head = () => {
        throw Error("unauthorized R2 read");
      };
      try {
        r = await f.req(path, user, options);
        assert.ok([401, 403, 404].includes(r.status));
        assert.equal(r.headers.get("etag"), null);
      } finally {
        f.env.FILES.head = oldHead;
      }
    }
  assert.equal((await f.req(path, 2, { method: "HEAD" })).status, 200);
  assert.equal((await f.req(path, 2, { headers: { Range: "bytes=0-3" } })).status, 206);
  assert.equal((await f.req(path, 2, { headers: { "If-None-Match": etag } })).status, 304);
  for (const raw of ["/" + photo.object_key, "/resources/999/file"])
    assert.ok([401, 404, 302].includes((await f.req(raw)).status));
  await f.action(record, 2, "consent");
  assert.equal((await f.req(path, 3)).status, 404);
  assert.equal(
    (await f.post(`/member-records/1/${record}/photos/${photo.id}/review`, 2, { version: "1", action: "approved" }))
      .status,
    403,
  );
  assert.equal(
    (await f.post(`/member-records/1/${record}/photos/${photo.id}/review`, 1, { version: "1", action: "rejected" }))
      .status,
    303,
  );
  assert.equal((await f.req(path, 2)).status, 404);
  assert.equal(
    (await f.post(`/member-records/1/${record}/photos/${photo.id}/review`, 1, { version: "2", action: "approved" }))
      .status,
    303,
  );
  await f.action(record, 1, "archive");
  assert.equal((await f.req(path, 2, { headers: { "If-None-Match": etag } })).status, 404);
  await f.action(record, 1, "restore");
  assert.equal((await f.req(path, 2)).status, 200);
  assert.equal((await f.upload(record, 3)).status, 404);
  assert.equal(
    (await f.upload(record, 2, crypto.randomUUID(), new File(["<svg>"], "bad.jpg", { type: "image/jpeg" }))).status,
    400,
  );
});

test("additive migration preserves old identities, bindings, file keys and public records", (t) => {
  const db = createDatabase(24);
  t.after(() => db.close());
  db.exec(
    "INSERT INTO member(id,name,photo) VALUES(812,'合成历史档案','legacy/photo.jpg'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(813,'合成历史绑定','fixture','member',812)",
  );
  const before = db.prepare("SELECT * FROM member WHERE id=812").get(),
    account = db.prepare("SELECT * FROM user WHERE id=813").get();
  db.exec(readFileSync("migrations/0025_member_records.sql", "utf8"));
  assert.deepEqual(db.prepare("SELECT * FROM member WHERE id=812").get(), before);
  assert.deepEqual(db.prepare("SELECT * FROM user WHERE id=813").get(), account);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM member_record").get().n, 0);
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
});

test("photo write failure leaves no orphan or charged reservation; cleanup retains archived references", async (t) => {
  const f = await setup(t),
    record = await f.create(1, "moment"),
    originalPut = f.env.FILES.put;
  f.env.FILES.put = async (...args) => {
    await originalPut(...args);
    throw Error("synthetic lost PUT acknowledgement");
  };
  assert.equal((await f.upload(record)).status, 500);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_record_photo").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM storage_reservation").get().n, 0);
  assert.equal((await f.env.FILES.list()).objects.length, 0);
  f.env.FILES.put = originalPut;
  assert.equal((await f.upload(record)).status, 303);
  const photo = f.db.prepare("SELECT * FROM member_record_photo").get();
  await f.action(record, 1, "archive");
  f.db.prepare("INSERT INTO file_cleanup_task(object_key) VALUES(?)").run(photo.object_key);
  await drainFileCleanup(f.env);
  assert.ok(await f.env.FILES.head(photo.object_key));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM member_record_photo_history").get().n, 1);
});

test("unrelated native forms with an action control do not break the legacy flower listener", async () => {
  const source = readFileSync("public/experience.js", "utf8").replaceAll("\r\n", "\n");
  const listenerSource = source.slice(source.indexOf("// Preserve the native POST")).split("\n})();")[0] + "\n})();";
  let listener;
  class NativeForm {
    action = { value: "verify" };
    getAttribute(name) {
      return name === "action" ? "/member-records/1/synthetic/action" : null;
    }
  }
  runInNewContext(listenerSource, {
    document: {
      addEventListener: (name, callback) => {
        assert.equal(name, "submit");
        listener = callback;
      },
    },
    HTMLFormElement: NativeForm,
    URL,
    location: { href: "https://blackbox.test/member-records/1" },
    fetch: () => assert.fail("unrelated form must remain native"),
  });
  await listener({
    target: new NativeForm(),
    preventDefault: () => assert.fail("native submission must not be intercepted"),
  });
});
