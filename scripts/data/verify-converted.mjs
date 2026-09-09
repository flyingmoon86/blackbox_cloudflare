import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const directory = resolve(process.argv[2] || "migration-work/converted");
const db = new DatabaseSync(":memory:");
for (const file of readdirSync(resolve("migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort())
  db.exec(readFileSync(resolve("migrations", file), "utf8"));
db.exec(readFileSync(resolve(directory, "import.sql"), "utf8"));

const expected = JSON.parse(readFileSync(resolve(directory, "expected-counts.json"), "utf8"));
const results = [];
for (const [table, count] of Object.entries(expected)) {
  const actual = Number(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
  results.push({ table, expected: Number(count), actual });
  if (actual !== Number(count)) throw new Error(`${table} 数量不符：实际 ${actual}，预期 ${count}`);
}
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
if (foreignKeys.length) throw new Error(`发现 ${foreignKeys.length} 条外键错误。`);
db.close();
console.log("转换结果已成功导入一次性内存数据库，数据量与外键均正确：");
for (const result of results) console.log(`- ${result.table}: ${result.actual}`);
console.log("下一步请查看 warnings.json，并核对 r2-files.json 中的旧文件路径。");
