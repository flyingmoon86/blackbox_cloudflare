import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

const input = resolve(process.argv[2] || "migration-work/export/snapshot.json");
const outputDir = resolve(process.argv[3] || "migration-work/converted");
const snapshot = JSON.parse(await readFile(input, "utf8"));
if (snapshot.version !== 1 || !snapshot.tables || typeof snapshot.tables !== "object")
  throw new Error("不支持的旧站快照格式。");
const table = (name) => {
  const rows = snapshot.tables[name] || [];
  if (!Array.isArray(rows)) throw new Error(`${name} 不是数组。`);
  return rows;
};
const text = (value, fallback = "") => (value == null ? fallback : String(value));
const integer = (value, fallback = null) => {
  const result = Number(value);
  return Number.isInteger(result) ? result : fallback;
};
const bool = (value) => (value === true || value === 1 || value === "1" ? 1 : 0);
const sql = (value) => {
  if (value == null) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
};
const dateTime = (value) => {
  if (!value) return null;
  const valueText = String(value)
    .replace("T", " ")
    .replace(/\.\d{3}Z?$/, "")
    .replace(/Z$/, "");
  return valueText.slice(0, 19);
};
const safeName = (value) =>
  basename(text(value))
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(-180) || "file";
const mime = (value) =>
  ({
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".pdf": "application/pdf",
  })[extname(value).toLowerCase()] || "application/octet-stream";
const insert = (name, columns, rows) =>
  rows.map(
    (row) =>
      `INSERT INTO ${name} (${columns.join(",")}) VALUES (${columns.map((column) => sql(row[column])).join(",")});`,
  );

const warnings = [];
const fileManifest = [];
const members = table("member").map((row) => {
  const id = integer(row.id);
  if (!id) throw new Error("member 存在无效 id。");
  const oldPhoto = text(row.photo);
  const photo = oldPhoto ? `legacy-avatars/${id}/${safeName(oldPhoto)}` : "";
  if (oldPhoto)
    fileManifest.push({
      kind: "avatar",
      objectKey: photo,
      sources: [`static/uploads/${oldPhoto}`],
      contentType: mime(oldPhoto),
    });
  return {
    id,
    name: text(row.name).slice(0, 50),
    bio: text(row.bio),
    join_year: integer(row.join_year),
    cohort: text(row.cohort).slice(0, 20),
    works: text(row.works),
    photo,
  };
});
const memberIds = new Set(members.map((row) => row.id));
const users = table("user").map((row) => ({
  id: integer(row.id),
  username: text(row.username).slice(0, 50),
  password_hash: text(row.password_hash),
  email: row.email || null,
  pending_email: row.pending_email || null,
  auth_version: integer(row.auth_version, 0),
  mail_sent_at: dateTime(row.mail_sent_at),
  join_hint_seen: bool(row.join_hint_seen),
  role: ["user", "member", "admin"].includes(row.role) ? row.role : "user",
  status: ["active", "disabled"].includes(row.status) ? row.status : "active",
  member_id: memberIds.has(integer(row.member_id)) ? integer(row.member_id) : null,
}));
if (users.some((row) => !row.id || !row.username || !row.password_hash))
  throw new Error("user 存在缺少 id、用户名或密码哈希的记录。");
const userIds = new Set(users.map((row) => row.id));
const productions = table("production").map((row) => ({
  id: integer(row.id),
  title: text(row.title).slice(0, 100),
  synopsis: text(row.synopsis),
  cover_id: integer(row.cover_id),
  cover_ratio: row.cover_ratio === "portrait" ? "portrait" : "landscape",
  promo: text(row.promo).slice(0, 300),
  feature_layout: row.feature_layout === "overlay" ? "overlay" : "split",
  year: integer(row.year),
}));
if (productions.some((row) => !row.id || !row.title)) throw new Error("production 存在缺少 id 或标题的记录。");
const productionIds = new Set(productions.map((row) => row.id));
const resources = table("resource").map((row) => {
  const id = integer(row.id);
  const oldName = text(row.filename);
  if (!id || !oldName) throw new Error("resource 存在缺少 id 或文件名的记录。");
  const objectKey = `legacy-resources/${id}/${safeName(oldName)}`;
  fileManifest.push({
    kind: "resource",
    objectKey,
    sources: [`static/resources/${oldName}`, `static/pending/${oldName}`],
    contentType: mime(oldName),
  });
  return {
    id,
    production_id: productionIds.has(integer(row.production_id)) ? integer(row.production_id) : null,
    status: ["pending", "approved", "rejected"].includes(row.status) ? row.status : "approved",
    uploader_id: userIds.has(integer(row.uploader_id)) ? integer(row.uploader_id) : null,
    admin_note: text(row.admin_note),
    title: text(row.title).slice(0, 100),
    res_type: ["video", "script", "photo", "audio", "other"].includes(row.res_type) ? row.res_type : "other",
    description: text(row.description),
    filename: objectKey,
    original_name: text(row.original_name) || oldName,
    download_count: Math.max(0, integer(row.download_count, 0)),
    created_at: dateTime(row.created_at) || "1970-01-01 00:00:00",
  };
});
const resourceIds = new Set(resources.map((row) => row.id));
for (const production of productions) {
  if (production.cover_id && !resourceIds.has(production.cover_id)) {
    warnings.push(`作品 ${production.id} 的封面资源 ${production.cover_id} 不存在，已清空。`);
    production.cover_id = null;
  }
}

let site = table("site_profile").find((row) => integer(row.id) === 1) || {};
let pageTexts = {};
try {
  pageTexts = JSON.parse(text(site.page_texts, "{}"));
} catch {
  warnings.push("page_texts 不是有效 JSON，已使用空对象。");
}
if (!pageTexts || Array.isArray(pageTexts) || typeof pageTexts !== "object") pageTexts = {};
if (!pageTexts.home_welcome && pageTexts.home_member) pageTexts.home_welcome = pageTexts.home_member;
for (const audience of ["member", "admin"]) {
  const items = pageTexts[`help_items_${audience}`];
  if (!pageTexts[`${audience}_guide`] && Array.isArray(items))
    pageTexts[`${audience}_guide`] = items.map((item) => `${text(item.title)}\n${text(item.body)}`).join("\n\n");
}
let heroPhoto = "";
const oldHero = text(site.hero_photo);
if (oldHero) {
  const heroId = Math.max(0, ...resources.map((row) => row.id)) + 1;
  const objectKey = `legacy-site/${heroId}/${safeName(oldHero)}`;
  resources.push({
    id: heroId,
    production_id: null,
    status: "approved",
    uploader_id: null,
    admin_note: "",
    title: "旧站首页背景",
    res_type: "photo",
    description: "从旧站剧团设置迁移",
    filename: objectKey,
    original_name: oldHero,
    download_count: 0,
    created_at: "1970-01-01 00:00:00",
  });
  resourceIds.add(heroId);
  heroPhoto = String(heroId);
  fileManifest.push({ kind: "hero", objectKey, sources: [`static/uploads/${oldHero}`], contentType: mime(oldHero) });
}
const siteProfile = [
  {
    id: 1,
    troupe_name: text(site.troupe_name, "话剧队").slice(0, 100) || "话剧队",
    introduction: site.introduction || null,
    contact_email: site.contact_email || "moonflying56@gmail.com",
    contact_wechat: site.contact_wechat || null,
    recruitment_open: bool(site.recruitment_open ?? 1),
    founded_year: integer(site.founded_year),
    qq_group: text(site.qq_group).slice(0, 50),
    public_account: text(site.public_account).slice(0, 100),
    recruitment: text(site.recruitment),
    requirements: text(site.requirements),
    hero_photo: heroPhoto,
    featured_production_id: productionIds.has(integer(site.featured_production_id))
      ? integer(site.featured_production_id)
      : null,
    page_texts: JSON.stringify(pageTexts),
  },
];

const joins = table("join_request").map((row) => ({
  id: integer(row.id),
  user_id: integer(row.user_id),
  apply_type: row.apply_type === "new" ? "new" : "bind",
  identity_note: text(row.identity_note),
  member_id: integer(row.member_id),
  name: text(row.name),
  bio: text(row.bio),
  join_year: integer(row.join_year),
  cohort: text(row.cohort).slice(0, 20),
  status: ["pending", "approved", "rejected"].includes(row.status) ? row.status : "pending",
  admin_note: text(row.admin_note),
  result_acknowledged: bool(row.result_acknowledged),
  created_at: dateTime(row.created_at) || "1970-01-01 00:00:00",
}));
for (const row of joins)
  if (
    !row.id ||
    !userIds.has(row.user_id) ||
    (row.apply_type === "bind" && !memberIds.has(row.member_id)) ||
    (row.apply_type === "new" && !row.name)
  )
    throw new Error(`join_request ${row.id ?? "未知"} 不满足新库约束。`);
const announcements = table("announcement").map((row) => ({
  id: integer(row.id),
  title: text(row.title).slice(0, 100),
  content: text(row.content),
  created_at: dateTime(row.created_at) || "1970-01-01 00:00:00",
}));
const memberResources = table("member_resource")
  .filter((row) => memberIds.has(integer(row.member_id)) && resourceIds.has(integer(row.resource_id)))
  .map((row) => ({ member_id: integer(row.member_id), resource_id: integer(row.resource_id) }));
const credits = table("production_credit").map((row) => ({
  id: integer(row.id),
  production_id: integer(row.production_id),
  member_id: integer(row.member_id),
  kind: row.kind === "crew" ? "crew" : "cast",
  role_name: text(row.role_name).slice(0, 80),
}));
for (const row of credits)
  if (!row.id || !productionIds.has(row.production_id) || !memberIds.has(row.member_id) || !row.role_name)
    throw new Error(`production_credit ${row.id ?? "未知"} 无效。`);
const flowers = table("flower").map((row) => ({
  id: integer(row.id),
  user_id: integer(row.user_id),
  member_id: integer(row.member_id),
  sent_on: text(row.sent_on).slice(0, 10),
}));
for (const row of flowers)
  if (!row.id || !userIds.has(row.user_id) || !memberIds.has(row.member_id) || !/\d{4}-\d{2}-\d{2}/.test(row.sent_on))
    throw new Error(`flower ${row.id ?? "未知"} 无效。`);

const data = {
  member: members,
  user: users,
  join_request: joins,
  announcement: announcements,
  production: productions,
  resource: resources,
  member_resource: memberResources,
  production_credit: credits,
  flower: flowers,
  site_profile: siteProfile,
};
const columns = {
  member: ["id", "name", "bio", "join_year", "cohort", "works", "photo"],
  user: [
    "id",
    "username",
    "password_hash",
    "email",
    "pending_email",
    "auth_version",
    "mail_sent_at",
    "join_hint_seen",
    "role",
    "status",
    "member_id",
  ],
  join_request: [
    "id",
    "user_id",
    "apply_type",
    "identity_note",
    "member_id",
    "name",
    "bio",
    "join_year",
    "cohort",
    "status",
    "admin_note",
    "result_acknowledged",
    "created_at",
  ],
  announcement: ["id", "title", "content", "created_at"],
  production: ["id", "title", "synopsis", "cover_id", "cover_ratio", "promo", "feature_layout", "year"],
  resource: [
    "id",
    "production_id",
    "status",
    "uploader_id",
    "admin_note",
    "title",
    "res_type",
    "description",
    "filename",
    "original_name",
    "download_count",
    "created_at",
  ],
  member_resource: ["member_id", "resource_id"],
  production_credit: ["id", "production_id", "member_id", "kind", "role_name"],
  flower: ["id", "user_id", "member_id", "sent_on"],
  site_profile: [
    "id",
    "troupe_name",
    "introduction",
    "contact_email",
    "contact_wechat",
    "recruitment_open",
    "founded_year",
    "qq_group",
    "public_account",
    "recruitment",
    "requirements",
    "hero_photo",
    "featured_production_id",
    "page_texts",
  ],
};
const deleteOrder = [
  "upload_part",
  "upload_task",
  "suggestion",
  "production_join_request",
  "production_credit",
  "member_resource",
  "flower",
  "join_request",
  "email_token",
  "resource",
  "announcement",
  "user",
  "member",
  "production",
  "site_profile",
];
const lines = [
  "PRAGMA foreign_keys = OFF;",
  "BEGIN;",
  ...deleteOrder.map((name) => `DELETE FROM ${name};`),
  ...Object.keys(data).flatMap((name) => insert(name, columns[name], data[name])),
  "COMMIT;",
  "PRAGMA foreign_keys = ON;",
];
const counts = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.length]));
const verify = [
  ...Object.keys(data).map(
    (name) =>
      `SELECT '${name}' AS table_name, COUNT(*) AS actual_count, ${counts[name]} AS expected_count FROM ${name};`,
  ),
  "PRAGMA foreign_key_check;",
];
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, "import.sql"), `${lines.join("\n")}\n`, "utf8");
await writeFile(resolve(outputDir, "verify.sql"), `${verify.join("\n")}\n`, "utf8");
await writeFile(resolve(outputDir, "expected-counts.json"), `${JSON.stringify(counts, null, 2)}\n`, "utf8");
await writeFile(
  resolve(outputDir, "r2-files.json"),
  `${JSON.stringify({ version: 1, files: fileManifest }, null, 2)}\n`,
  "utf8",
);
await writeFile(resolve(outputDir, "warnings.json"), `${JSON.stringify(warnings, null, 2)}\n`, "utf8");
console.log(`已生成 D1 导入与 R2 文件清单：${outputDir}`);
console.log(`数据量：${JSON.stringify(counts)}`);
if (warnings.length) console.log(`请检查 ${warnings.length} 条迁移警告。`);
