import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
const source = process.argv[2];
if (!source) throw Error("请提供已有 D1 SQL 导出路径；此命令只在内存中检查升级，不连接 Cloudflare。");
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(source, "utf8"));
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const tables = db
  .prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations') ORDER BY name",
  )
  .all();
const hash = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const before = tables.map(({ name }) => {
  const fields = db
    .prepare("PRAGMA table_info(" + quote(name) + ")")
    .all()
    .map((r) => quote(r.name))
    .join(",");
  const sql = "SELECT " + fields + " FROM " + quote(name) + " ORDER BY rowid";
  const rows = db.prepare(sql).all();
  return { name, sql, count: rows.length, digest: hash(rows) };
});
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) n FROM (SELECT user_id FROM join_request WHERE status='pending' GROUP BY user_id HAVING COUNT(*)>1)",
    )
    .get().n,
  0,
  "存在重复待审核申请，需要管理员确认",
);
assert.equal(
  db
    .prepare(
      "SELECT COUNT(*) n FROM (SELECT production_id,member_id,kind,role_name COLLATE NOCASE FROM production_credit GROUP BY production_id,member_id,kind,role_name COLLATE NOCASE HAVING COUNT(*)>1)",
    )
    .get().n,
  0,
  "存在重复演职员记录，需要管理员确认",
);
const hasNewSchema = db
  .prepare("PRAGMA table_info(resource)")
  .all()
  .some((row) => row.name === "reviewed_by");
if (hasNewSchema) throw Error("这个导出已经有新结构；请使用优化前的 0001–0008 快照验证升级。");
db.exec("BEGIN");
try {
  for (const name of readdirSync("migrations")
    .filter((name) => Number(name.split("_")[0]) >= 9 && name.endsWith(".sql"))
    .sort())
    db.exec(readFileSync("migrations/" + name, "utf8"));
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
for (const item of before) {
  const rows = db.prepare(item.sql).all();
  assert.equal(rows.length, item.count, item.name + " 行数变化");
  assert.equal(hash(rows), item.digest, item.name + " 原字段变化");
  console.log("保留：" + item.name + "（" + item.count + " 行）");
}
assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
console.log("升级验证通过：原字段、ID、哈希、引用和行数保持一致；未写入本地或生产数据库。");
db.close();
