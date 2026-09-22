import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { creditFixture } from "./credit-import-fixture.mjs";
import { loadModule } from "./harness.mjs";
const { parseImport } = await loadModule("src/services/credit-import/parser.ts");
const { purgeExpiredImports } = await loadModule("src/services/credit-import/commit.ts");
const { safeWorkbook } = await loadModule("src/services/credit-import/parser.ts");
const header = "*姓名,外部ID,*类别,*角色或分工\n";
const actor = 1;
async function preview(s, text) {
  const res = await s.upload(header + text);
  assert.equal(res.status, 303, await res.clone().text());
  return res.headers.get("location");
}
const revision = (s, path) =>
  String(s.db.prepare("SELECT revision FROM credit_import_batch WHERE id=?").get(path.split("/").pop()).revision);
const change = (s, path, action, fields = {}) =>
  s.post(actor, path + "/" + action, { revision: revision(s, path), confirm: "yes", ...fields });
test("CSV/XLSX template, exact example, malformed/oversized/formula/prototype inputs", async () => {
  const parse = (text) => parseImport(new File([text], "test.csv"));
  const rows = await parse(header + '张三,,演员,"哈姆雷特,甲"\n');
  assert.equal(rows[0].row_number, 2);
  assert.equal(rows[0].role_name, "哈姆雷特,甲");
  assert.equal((await parse(header + "张三,BB-M-0001,演员,哈姆雷特\n李四,,后台与创作,灯光"))[0].row_number, 3);
  for (const input of [
    header,
    header + '"未闭合',
    header + "张三,,演员,角,多余",
    header + "张三,,演员,角\n".repeat(51),
  ])
    await assert.rejects(parse(input));
  assert.equal((await parse(header + "张三,,toString,角"))[0].resolution, "error");
  assert.equal((await parse(header + "=1+1,,演员,角"))[0].resolution, "error");
  const longRows = await parse(
    header + Array.from({ length: 50 }, (_, i) => `${"超".repeat(100)}${i},,演员,角色`).join("\n"),
  );
  assert.ok(longRows.every((row) => row.person_key.length <= 55 && row.member_name.length <= 50));
  assert.ok(Buffer.byteLength(JSON.stringify(longRows)) < 100_000, "invalid rows stay bounded before D1 persistence");
  await assert.rejects(parseImport(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.csv")));
  const original = readFileSync("templates/production-credit-import-v1.xlsx");
  await assert.rejects(parseImport(new File([original], "template.xlsx")), /没有可导入/);
  const files = unzipSync(original);
  const key = "xl/worksheets/sheet1.xml";
  const xml = strFromU8(files[key]);
  for (const forbidden of ["<f>1+1</f>", '<mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>']) {
    files[key] = strToU8(xml.replace(/<\/(?:\w+:)?worksheet>/, forbidden + "</x:worksheet>"));
    await assert.rejects(parseImport(new File([zipSync(files)], "bad.xlsx")), /禁止/);
  }
});
test("admin preview -> resolution -> atomic import -> replay -> guarded rollback", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(
      s,
      "张三,EXT-1,演员,主角\n新队员,,后台与创作,灯光\n新队员,,后台与创作,灯光\n张三,EXT-1,演员,旁白",
    );
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    assert.equal((await change(s, path, "confirm")).status, 409);
    assert.equal((await change(s, path, "resolve", { decision_3: "create", decision_4: "create" })).status, 303);
    assert.equal((await change(s, path, "resolve")).status, 303, "choices survive reevaluation");
    const ready = await (await s.req(1, path)).text();
    assert.match(ready, /确认入库/);
    assert.equal((await change(s, path, "confirm")).status, 303);
    assert.equal((await s.post(1, path + "/confirm", { revision: "0", confirm: "yes" })).status, 303);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 3);
    assert.equal(s.db.prepare("SELECT bio FROM member WHERE id=1").get().bio, "保留简介");
    assert.equal(s.db.prepare("SELECT external_id FROM member WHERE id=1").get().external_id, "EXT-1");
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM user").get().n, 3);
    assert.equal(
      await preview(s, "张三,EXT-1,演员,主角\n新队员,,后台与创作,灯光\n新队员,,后台与创作,灯光\n张三,EXT-1,演员,旁白"),
      path,
    );
    assert.equal((await change(s, path, "rollback")).status, 303);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM member WHERE name='新队员'").get().n, 0);
    assert.equal(s.db.prepare("SELECT external_id FROM member WHERE id=1").get().external_id, null);
    assert.equal((await change(s, path, "rollback")).status, 303);
  } finally {
    s.db.close();
  }
});
test("permissions, CSRF, parent mismatch, illegal query and required confirmation", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(s, "张三,,演员,角");
    for (const id of [0, 2, 3]) {
      for (const url of [
        path,
        path + "/errors.csv",
        "/admin/credit-imports",
        "/admin/productions/10/credits/import/template.xlsx",
      ]) {
        assert.ok([302, 403].includes((await s.req(id, url)).status));
      }
      for (const action of ["resolve", "confirm", "rollback"])
        assert.ok(
          [302, 403].includes((await s.post(id, path + "/" + action, { confirm: "yes", revision: "0" })).status),
        );
      assert.ok([302, 403].includes((await s.upload(header + "张三,,演员,角", id)).status));
    }
    assert.equal((await s.upload(header + "张三,,演员,角", 1, { csrf: "bad" })).status, 400);
    assert.equal((await s.upload(header + "张三,,演员,角", 1, { edition_id: "999" })).status, 404);
    assert.equal((await s.req(1, "/admin/credit-imports?page=oops")).status, 400);
    assert.equal((await s.post(1, path + "/confirm", { revision: "0" })).status, 400);
    assert.equal((await s.post(1, path + "/confirm", { revision: "0", confirm: "yes", csrf: "bad" })).status, 400);
    const origin = await s.req(1, path + "/confirm", {
      method: "POST",
      headers: { Origin: "https://evil.test" },
      body: new URLSearchParams({ csrf: "credit-csrf", revision: "0", confirm: "yes" }),
    });
    assert.equal(origin.status, 403);
    for (const update of [
      "status='disabled'",
      "status='active',must_change_password=1",
      "must_change_password=0,auth_version=1",
    ]) {
      s.db.exec("UPDATE user SET " + update + " WHERE id=1");
      assert.ok([302, 403].includes((await s.post(1, path + "/confirm", { revision: "0", confirm: "yes" })).status));
    }
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
  } finally {
    s.db.close();
  }
});
test("stale member, stale batch and database failure roll back the entire import", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(s, "张三,,演员,角\n李四,,后台与创作,舞美");
    s.db.exec("UPDATE member SET bio='其他管理员修改' WHERE id=1");
    assert.equal((await change(s, path, "confirm")).status, 409);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    assert.equal((await change(s, path, "resolve")).status, 303);
    assert.equal((await s.post(1, path + "/confirm", { revision: "0", confirm: "yes" })).status, 409);
    s.db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON production_credit WHEN NEW.kind='crew' BEGIN SELECT RAISE(ABORT,'CHECK failure'); END;",
    );
    assert.equal((await change(s, path, "confirm")).status, 409);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM credit_import_guard").get().n, 0);
    s.db.exec("DROP TRIGGER fail_import");
    assert.equal((await change(s, path, "confirm")).status, 303);
  } finally {
    s.db.close();
  }
});
test("ambiguous names, excluded invalid rows, AB roles and existing duplicates", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(s, "同名,,演员,主角\n张三,,演员,主角\n李四,,演员,主角\n缺项,,演员,");
    assert.equal((await change(s, path, "resolve", { decision_2: "match:3", decision_5: "skip" })).status, 303);
    assert.equal((await change(s, path, "resolve", { decision_5: "auto" })).status, 303);
    assert.equal((await change(s, path, "confirm")).status, 409, "restored invalid row stays invalid");
    await change(s, path, "resolve", { decision_5: "skip" });
    assert.equal((await change(s, path, "confirm")).status, 303);
    const again = await preview(s, "张三,,演员,主角\n李四,,演员,新角色");
    assert.equal((await change(s, again, "confirm")).status, 303);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 4);
    assert.match(await (await s.req(1, path + "/errors.csv")).text(), /管理员已排除/);
  } finally {
    s.db.close();
  }
});
test("rollback retains edited credits and later-linked new profiles; expiration keeps audit", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(s, "新甲,,演员,角色\n新乙,,后台与创作,舞美");
    await change(s, path, "resolve", { decision_2: "create", decision_3: "create" });
    await change(s, path, "confirm");
    s.db.exec(
      "UPDATE production_credit SET role_name='后改角色' WHERE kind='cast';UPDATE member SET bio='后来补充' WHERE name='新乙'",
    );
    assert.equal((await change(s, path, "rollback")).status, 303);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM member WHERE name LIKE '新%'").get().n, 2);
    assert.match(await (await s.req(1, path)).text(), /有后续修改或引用/);
    s.db.exec("UPDATE credit_import_batch SET created_at=datetime('now','-181 days')");
    await purgeExpiredImports(s.env.DB);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM credit_import_row").get().n, 0);
    assert.ok(s.db.prepare("SELECT COUNT(*) n FROM credit_import_event").get().n > 0);
    assert.equal((await change(s, path, "rollback")).status, 409);
  } finally {
    s.db.close();
  }
});

test("50 rows commit together, shared identity stays unique, conflicting identities cannot commit", async () => {
  const s = await creditFixture();
  try {
    const path = await preview(s, Array.from({ length: 50 }, (_, i) => `批量新人,,演员,角色${i}`).join("\n"));
    const decisions = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`decision_${i + 2}`, "create"]));
    assert.equal((await change(s, path, "resolve", decisions)).status, 303);
    assert.equal((await change(s, path, "confirm")).status, 303);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM member WHERE name='批量新人'").get().n, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 50);
    const notices = await (await s.req(1, "/admin/notifications")).json();
    assert.equal(notices.pendingTotal, 0, "completed imports are not pending tasks");
    const notice = notices.items.find((item) => item.key.startsWith("credit-import:"));
    assert.equal(notice.informational, true);
    assert.equal((await s.post(1, "/admin/notifications/dismiss", { key: notice.key })).status, 200);
    assert.equal((await (await s.req(1, "/admin/notifications")).json()).items.length, 0);
    const conflict = await preview(s, "同一人,ID-A,演员,甲\n同一人,ID-B,演员,乙");
    await change(s, conflict, "resolve", { decision_2: "create", decision_3: "create" });
    assert.equal((await change(s, conflict, "confirm")).status, 409);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM member WHERE name='同一人'").get().n, 0);
  } finally {
    s.db.close();
  }
});
test("compressed expansion, malicious worksheet dimensions and CSV error-report formulas are rejected/safe", async () => {
  const original = unzipSync(readFileSync("templates/production-credit-import-v1.xlsx"));
  const huge = { ...original, "xl/worksheets/sheet1.xml": strToU8(" ".repeat(2 * 1024 * 1024 + 1)) };
  assert.throws(() => safeWorkbook(zipSync(huge)), /过大/);
  const sparse = {
    ...original,
    "xl/worksheets/sheet1.xml": strToU8(
      strFromU8(original["xl/worksheets/sheet1.xml"]).replace('r="A1"', "r='A1000000'"),
    ),
  };
  assert.throws(() => safeWorkbook(zipSync(sparse)), /范围过大/);
  const relocated = { ...original };
  relocated["xl/alternate.xml"] = strToU8(
    strFromU8(original["xl/worksheets/sheet1.xml"]).replace('r="A1"', "r='A2048'"),
  );
  relocated["xl/_rels/workbook.xml.rels"] = strToU8(
    strFromU8(original["xl/_rels/workbook.xml.rels"]).replace("worksheets/sheet1.xml", "alternate.xml"),
  );
  relocated["[Content_Types].xml"] = strToU8(
    strFromU8(original["[Content_Types].xml"]).replace("/xl/worksheets/sheet1.xml", "/xl/alternate.xml"),
  );
  delete relocated["xl/worksheets/sheet1.xml"];
  assert.throws(() => safeWorkbook(zipSync(relocated)), /范围过大/);
  const external = { ...original, "xl/externalLinks/externalLink1.xml": strToU8("<link/>") };
  assert.throws(() => safeWorkbook(zipSync(external)), /外部链接/);
  const s = await creditFixture();
  try {
    const path = await preview(s, "=HYPERLINK(1),,演员,角色");
    const report = await (await s.req(1, path + "/errors.csv")).text();
    assert.match(report, /"'=HYPERLINK/);
    const response = await s.req(1, "/admin/productions/10/credits/import/template.xlsx");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /private.*no-store/);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      readFileSync("templates/production-credit-import-v1.xlsx"),
    );
  } finally {
    s.db.close();
  }
});
