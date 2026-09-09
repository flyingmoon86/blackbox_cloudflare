import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const TABLES = [
  "member",
  "user",
  "join_request",
  "announcement",
  "production",
  "resource",
  "member_resource",
  "production_credit",
  "flower",
  "site_profile",
];

for (const name of ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]) {
  if (!process.env[name]) throw new Error(`缺少环境变量 ${name}`);
}

const outputDir = resolve(process.argv[2] || `migration-work/export-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(outputDir, { recursive: true });
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  charset: "utf8mb4",
  timezone: "Z",
});

const tables = {};
try {
  await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  const [existingRows] = await connection.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=?",
    [process.env.DB_NAME],
  );
  const existing = new Set(existingRows.map((row) => row.TABLE_NAME || row.table_name));
  for (const table of TABLES) {
    if (!existing.has(table)) {
      tables[table] = [];
      continue;
    }
    const [rows] = await connection.query(`SELECT * FROM \`${table}\``);
    tables[table] = rows;
  }
  await connection.query("COMMIT");
} catch (error) {
  await connection.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await connection.end();
}

const snapshot = {
  version: 1,
  exportedAt: new Date().toISOString(),
  source: { engine: "mysql", database: process.env.DB_NAME },
  tables,
};
const text = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile(resolve(outputDir, "snapshot.json"), text, "utf8");
await writeFile(
  resolve(outputDir, "manifest.json"),
  `${JSON.stringify(
    {
      version: 1,
      sha256: createHash("sha256").update(text).digest("hex"),
      counts: Object.fromEntries(TABLES.map((table) => [table, tables[table].length])),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`旧 MySQL 已只读导出到：${outputDir}`);
