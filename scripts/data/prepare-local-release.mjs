import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Only explicit, reviewed IDs are exported. The original database is never modified.
const [backup, selectionFile, outputDirectory] = process.argv.slice(2);
if (!backup || !selectionFile || !outputDirectory) {
  throw new Error("用法：node scripts/data/prepare-local-release.mjs <本地备份.sql> <选择清单.json> <输出目录>");
}
const selection = JSON.parse(readFileSync(selectionFile, "utf8"));
for (const key of ["users", "members", "productions", "resources", "announcements"]) {
  if (!Array.isArray(selection[key]) || selection[key].some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error(`选择清单 ${key} 必须是明确的正整数 ID 数组。`);
  }
}
const database = new DatabaseSync(":memory:");
database.exec(readFileSync(backup, "utf8"));
function selected(table, ids) {
  const rows = database
    .prepare(`SELECT * FROM ${table} ORDER BY id`)
    .all()
    .filter((row) => ids.includes(row.id));
  if (rows.length !== new Set(ids).size) throw new Error(`${table} 中存在找不到的 ID。`);
  return rows;
}
const members = selected("member", selection.members);
const users = selected("user", selection.users).map((row) => ({
  ...row,
  auth_version: row.auth_version + 1,
  member_id: selection.members.includes(row.member_id) ? row.member_id : null,
}));
if (!users.some((row) => row.role === "admin" && row.status === "active")) throw new Error("必须保留一个有效管理员。");
const productions = selected("production", selection.productions).map((row) => ({
  ...row,
  cover_id: selection.resources.includes(row.cover_id) ? row.cover_id : null,
}));
const resources = selected("resource", selection.resources).map((row) => ({
  ...row,
  uploader_id: selection.users.includes(row.uploader_id) ? row.uploader_id : null,
  production_id: selection.productions.includes(row.production_id) ? row.production_id : null,
}));
const profile = database.prepare("SELECT * FROM site_profile WHERE id=1").get();
if (!profile) throw new Error("缺少页面设置。");
profile.featured_production_id = selection.productions.includes(profile.featured_production_id)
  ? profile.featured_production_id
  : null;
for (const key of ["hero_photo", "page_background_photo"]) {
  if (!selection.resources.includes(Number(profile[key]))) profile[key] = "";
}
const tables = {
  member: members,
  user: users,
  production: productions,
  resource: resources,
  member_resource: database
    .prepare("SELECT * FROM member_resource")
    .all()
    .filter((row) => selection.members.includes(row.member_id) && selection.resources.includes(row.resource_id)),
  production_credit: database
    .prepare("SELECT * FROM production_credit")
    .all()
    .filter((row) => selection.members.includes(row.member_id) && selection.productions.includes(row.production_id)),
  announcement: selected("announcement", selection.announcements),
  site_profile: [profile],
};
function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return "'" + String(value).replaceAll("'", "''") + "'";
}
const statements = [
  "-- 仅导入已确认的内容；目标必须是全新且已完成 migrations 的数据库。",
  "DELETE FROM site_profile WHERE id=1;",
];
for (const [table, rows] of Object.entries(tables)) {
  for (const row of rows) {
    const columns = Object.keys(row);
    statements.push(
      `INSERT INTO ${table} (${columns.map((key) => `"${key}"`).join(",")}) VALUES (${columns.map((key) => literal(row[key])).join(",")});`,
    );
  }
}
const keys = new Set();
for (const row of members) if (row.photo) keys.add(row.photo);
for (const row of resources) {
  if (row.filename) keys.add(row.filename);
  if (row.preview_filename) keys.add(row.preview_filename);
}
const counts = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]));
const output = resolve(outputDirectory);
const verification = new DatabaseSync(":memory:");
for (const file of readdirSync("migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  verification.exec(readFileSync(join("migrations", file), "utf8"));
}
verification.exec(statements.join("\n"));
if (verification.prepare("PRAGMA foreign_key_check").all().length) throw new Error("迁移数据外键检查失败。");
for (const [table, count] of Object.entries(counts)) {
  if (verification.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count !== count)
    throw new Error(`${table} 数量不一致。`);
}
verification.close();
mkdirSync(output, { recursive: true });
writeFileSync(join(output, "import.sql"), statements.join("\n") + "\n");
writeFileSync(join(output, "counts.json"), JSON.stringify(counts, null, 2));
writeFileSync(join(output, "object-keys.json"), JSON.stringify([...keys], null, 2));
database.close();
console.log(JSON.stringify({ counts, objects: keys.size, output }));
