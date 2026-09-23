import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { creditFixture } from "./credit-import-fixture.mjs";
import { loadModule } from "./harness.mjs";
const { parseImport, parseImportFile, parseCsv } = await loadModule("src/services/credit-import/parser.ts");
const { purgeExpiredImports } = await loadModule("src/services/credit-import/commit.ts");
const { safeWorkbook } = await loadModule("src/services/credit-import/parser.ts");
const header = "*姓名,外部ID,*类别,*角色或分工\n";
const headerV2 = "*姓名,*类别,*角色或分工\n";
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
    const review = await (await s.req(1, path)).text();
    assert.match(review, /需要手动处理 <span>2<\/span>/);
    assert.match(review, /自动匹配与已处理 <span>2<\/span>/);
    assert.match(review, /import-row import-row--compact/);
    assert.match(review, /调整关联/);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    assert.equal((await change(s, path, "confirm")).status, 409);
    assert.equal((await change(s, path, "resolve", { decision_3: "create", decision_4: "create" })).status, 303);
    assert.equal((await change(s, path, "resolve")).status, 303, "choices survive reevaluation");
    const ready = await (await s.req(1, path)).text();
    assert.match(ready, /确认入库/);
    assert.match(ready, /data-import-confirm/);
    assert.equal((await (await s.req(1, path + "/status")).json()).status, "ready");
    const jsonConfirm = await s.req(1, path + "/confirm", {
      method: "POST",
      headers: { Accept: "application/json" },
      body: new URLSearchParams({ csrf: "credit-csrf", revision: revision(s, path), confirm: "yes" }),
    });
    assert.equal(jsonConfirm.status, 200);
    assert.deepEqual(await jsonConfirm.json(), { status: "committed", url: path });
    assert.equal((await (await s.req(1, path + "/status")).json()).status, "committed");
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
        path + "/status",
        "/admin/credit-imports",
        "/admin/credit-imports/new",
        "/admin/credit-imports/new?production_id=10",
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
  const excelSaved = {
    ...original,
    "xl/worksheets/sheet1.xml": strToU8(
      strFromU8(original["xl/worksheets/sheet1.xml"]).replace(
        "<x:worksheet ",
        '<x:worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      ),
    ),
  };
  assert.doesNotThrow(() => safeWorkbook(zipSync(excelSaved)));
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
      readFileSync("templates/production-credit-import-v2.xlsx"),
    );
  } finally {
    s.db.close();
  }
});

test("v2 downloads have three fields; XLSX/CSV round trips and legacy version remain supported", async () => {
  const s = await creditFixture();
  try {
    const response = await s.req(1, "/admin/productions/10/credits/import/template.csv");
    assert.match(response.headers.get("content-disposition"), /v2\.csv/);
    const template = await response.text();
    assert.deepEqual(parseCsv(template.replace(/^\uFEFF/, ""))[0], ["*姓名", "*类别", "*角色或分工"]);
    assert.doesNotMatch(template, /ID|编号/);
    const parsed = await parseImportFile(new File([template + "李四,后台与创作,灯光\n"], "new.csv"));
    assert.equal(parsed.version, 2);
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].external_id, null);
    assert.equal(parsed.rows[0].row_number, 3);
    for (const version of [1, 2]) {
      const source = readFileSync(`templates/production-credit-import-v${version}.xlsx`);
      await assert.rejects(parseImport(new File([source], "blank.xlsx")), /没有可导入/);
      const files = unzipSync(source);
      for (const key of Object.keys(files)) files[key] = strToU8(strFromU8(files[key]).replaceAll("张三", "李四"));
      const parsed = await parseImportFile(new File([zipSync(files)], "filled.xlsx"));
      assert.equal(parsed.version, version);
      assert.equal(parsed.rows[0].member_name, "李四");
      assert.equal(parsed.rows[0].external_id, version === 1 ? "BB-M-0001" : null);
    }
    assert.equal(
      (await parseImport(new File([headerV2 + "张三,演员,"], "missing.csv")))[0].input_error,
      "角色或分工必填",
    );
    await assert.rejects(parseImport(new File([headerV2 + "新人,演员,角色\n".repeat(51)], "large.csv")), /50 行/);
    await assert.rejects(
      parseImport(new File(["*姓名,*角色或分工,*类别\n甲,角色,演员"], "wrong.csv")),
      /姓名、类别、角色或分工/,
    );
  } finally {
    s.db.close();
  }
});

test("no-ID imports require explicit missing/ambiguous decisions, preserve existing IDs and replay safely", async () => {
  const s = await creditFixture();
  try {
    s.db.exec("UPDATE member SET external_id='EXISTING-1' WHERE id=1");
    const text = headerV2 + "张三,演员,主角\n同名,演员,配角\n新姓名,后台与创作,灯光";
    const response = await s.upload(text);
    assert.equal(response.status, 303);
    const path = response.headers.get("location");
    const batch = s.db.prepare("SELECT * FROM credit_import_batch WHERE id=?").get(path.split("/").pop());
    assert.equal(batch.template_version, 2);
    const rows = s.db.prepare("SELECT * FROM credit_import_row WHERE batch_id=? ORDER BY row_number").all(batch.id);
    assert.deepEqual(
      rows.map((r) => [r.resolution, r.matched_member_id]),
      [
        ["matched", 1],
        ["unresolved", null],
        ["unresolved", null],
      ],
    );
    assert.deepEqual(
      rows.map((r) => r.error_code),
      ["", "ambiguous", "missing"],
    );
    assert.equal((await change(s, path, "confirm")).status, 409);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 0);
    const html = await (await s.req(1, path)).text();
    assert.doesNotMatch(html, /外部ID|EXISTING-1|未填写编号/);
    assert.match(html, /核对候选档案/);
    await change(s, path, "resolve", { decision_3: "match:3", decision_4: "create" });
    assert.equal((await change(s, path, "confirm")).status, 303);
    assert.equal(s.db.prepare("SELECT external_id FROM member WHERE id=1").get().external_id, "EXISTING-1");
    assert.match(s.db.prepare("SELECT external_id FROM member WHERE name='新姓名'").get().external_id, /^BB-/);
    assert.equal((await s.upload(text)).headers.get("location"), path);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_credit").get().n, 3);
    const legacy = await preview(s, "张三,EXISTING-1,演员,旧表角色");
    assert.equal(
      s.db.prepare("SELECT template_version FROM credit_import_batch WHERE id=?").get(legacy.split("/").pop())
        .template_version,
      1,
    );
    assert.equal(await preview(s, "张三,EXISTING-1,演员,旧表角色"), legacy);
    const invalid = await s.upload(headerV2 + "新姓名,演员,");
    const report = await (await s.req(1, invalid.headers.get("location") + "/errors.csv")).text();
    // Reports include diagnostics, so they intentionally have more columns than upload templates.
    assert.equal(report.replace(/^\uFEFF/, "").split("\r\n")[0], '"原表行号","*姓名","*类别","*角色或分工","原因"');
    assert.match(report, /"2","新姓名","演员","","角色或分工必填"/);
    assert.doesNotMatch(report, /外部ID/);
    assert.equal((await change(s, path, "rollback")).status, 303);
    assert.equal(s.db.prepare("SELECT external_id FROM member WHERE id=1").get().external_id, "EXISTING-1");
  } finally {
    s.db.close();
  }
});

test("admin workbench groups actionable tasks and direct forms; import selection validates target", async () => {
  const s = await creditFixture();
  try {
    const html = await (await s.req(1, "/admin")).text();
    assert.match(html, /id="dashboard-pending-title">待处理/);
    assert.match(html, /id="dashboard-fill-title">填资料/);
    const fill = html.match(/<nav class="dashboard-tools"[^>]*>([\s\S]*?)<\/nav>/)[1];
    const urls = [...fill.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(urls, [
      "/admin/productions/new",
      "/admin/members/new",
      "/admin/credit-imports/new",
      "/resources/submit",
      "/admin/announcements/new",
      "/admin/site",
    ]);
    for (const url of urls) {
      const response = await s.req(1, url);
      assert.equal(response.status, 200, url);
      assert.match(await response.text(), /<form[^>]+(?:method|action)=/);
    }
    for (const id of [0, 2, 3]) assert.ok([302, 403].includes((await s.req(id, "/admin")).status));
    assert.equal((await s.req(1, "/admin/credit-imports/new?production_id=oops")).status, 400);
    assert.equal((await s.req(1, "/admin/credit-imports/new?production_id=99999")).status, 404);
    assert.equal(
      (await s.req(1, "/admin/credit-imports/new?production_id=10")).headers.get("location"),
      "/admin/productions/10/credits/import",
    );
    s.db.exec("UPDATE production SET is_hidden=1 WHERE id=10");
    assert.match(await (await s.req(1, "/admin/credit-imports/new")).text(), /合成作品 · 2026 · 已隐藏/);
    s.db.exec("DELETE FROM production");
    assert.match(await (await s.req(1, "/admin/credit-imports/new")).text(), /还没有作品/);
  } finally {
    s.db.close();
  }
});
