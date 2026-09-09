import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const output = resolve("migration-work/test-converted");
rmSync(output, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [resolve("scripts/data/transform-legacy.mjs"), resolve("test-fixtures/migration-sample/snapshot.json"), output],
  { stdio: "inherit" },
);
const db = new DatabaseSync(":memory:");
db.exec(readFileSync(resolve("migrations/0001_core.sql"), "utf8"));
db.exec(readFileSync(resolve("migrations/0002_upload_resume.sql"), "utf8"));
db.exec(readFileSync(resolve(output, "import.sql"), "utf8"));
const expected = JSON.parse(readFileSync(resolve(output, "expected-counts.json"), "utf8"));
for (const [table, count] of Object.entries(expected)) {
  const actual = db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count;
  if (actual !== count) throw new Error(`${table} 数量不符：${actual}/${count}`);
}
const member = db.prepare("SELECT photo FROM member WHERE id=1").get();
const resource = db.prepare("SELECT filename FROM resource WHERE id=1").get();
const site = db.prepare("SELECT hero_photo,page_texts FROM site_profile WHERE id=1").get();
if (member.photo !== "legacy-avatars/1/avatar.png") throw new Error("头像对象键转换错误");
if (resource.filename !== "legacy-resources/1/photo.png") throw new Error("资源对象键转换错误");
if (Number(site.hero_photo) !== 2) throw new Error("旧首页背景未转换为资料记录");
const texts = JSON.parse(site.page_texts);
if (texts.home_welcome !== "旧欢迎语" || !texts.member_guide.includes("先登录")) throw new Error("旧页面文案转换错误");
const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
if (foreignKeys.length) throw new Error(`存在 ${foreignKeys.length} 条外键错误`);
const manifest = JSON.parse(readFileSync(resolve(output, "r2-files.json"), "utf8"));
if (manifest.files.length !== 3) throw new Error("R2 文件清单数量错误");
db.close();
console.log("旧 MySQL 快照转换、D1 导入、外键、文案和 R2 清单验证均通过。");
