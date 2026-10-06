import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "./backend/harness.mjs";
import { createSnapshot, restoreLocal } from "./archive-backup.mjs";

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";

export function archiveFixture() {
  const db = createDatabase();
  db.exec(`INSERT INTO member(id,name,photo,avatar_preview) VALUES(1,'恢复演练队员','avatar.jpg','avatar-small.jpg');
    INSERT INTO user(id,username,password_hash,role) VALUES(1,'restore-fixture','fixture-only','admin');
    INSERT INTO production(id,title,year) VALUES(1,'恢复演练作品',2026);
    INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) SELECT 1,id,1,'cast','演员' FROM production_edition WHERE production_id=1;
    INSERT INTO resource(production_id,edition_id,title,res_type,filename,preview_filename) SELECT 1,id,'恢复演练剧照','photo','photo.jpg','preview.jpg' FROM production_edition WHERE production_id=1;
    INSERT INTO resource(title,res_type,filename) VALUES('恢复演练剧本','script','script.pdf');`);
  const schema = db
    .prepare(
      "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
    )
    .all();
  const tables = schema.filter((row) => row.type === "table");
  const sql = ["PRAGMA defer_foreign_keys=ON;", ...tables.map((row) => row.sql + ";")];
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${quote(table.name)}`).all();
    for (const row of rows)
      sql.push(
        `INSERT INTO ${quote(table.name)} (${Object.keys(row).map(quote).join(",")}) VALUES(${Object.values(row).map(literal).join(",")});`,
      );
  }
  sql.push(...schema.filter((row) => row.type !== "table").map((row) => row.sql + ";"));
  db.close();
  const files = new Map(
    ["avatar.jpg", "avatar-small.jpg", "photo.jpg", "preview.jpg", "script.pdf"].map((key) => [
      key,
      Buffer.from("archive fixture bytes: " + key),
    ]),
  );
  let downloads = 0;
  const inventory = () =>
    [...files].map(([key, bytes]) => ({
      key,
      size: bytes.length,
      etag: createHash("md5").update(bytes).digest("hex"),
      last_modified: "2026-10-04T00:00:00Z",
      http_metadata: { contentType: key.endsWith("pdf") ? "application/pdf" : "image/jpeg" },
      custom_metadata: {},
    }));
  const client = {
    async list(cursor) {
      const start = Number(cursor || 0),
        objects = inventory();
      return {
        success: true,
        result: objects.slice(start, start + 2),
        result_info: {
          is_truncated: start + 2 < objects.length,
          cursor: start + 2 < objects.length ? String(start + 2) : undefined,
        },
      };
    },
    async get(key) {
      downloads++;
      const bytes = files.get(key);
      return bytes
        ? new Response(bytes, { headers: { etag: createHash("md5").update(bytes).digest("hex") } })
        : new Response(null, { status: 404 });
    },
  };
  return {
    sql: sql.join("\n"),
    client,
    files,
    get downloads() {
      return downloads;
    },
    source: { database: "fixture", bucket: "fixture" },
  };
}

export async function runFixtureDrill(target) {
  if (existsSync(target)) throw new Error("演练目录已经存在，请指定新目录。");
  await mkdir(target, { recursive: true });
  const fixture = archiveFixture();
  const backup = await createSnapshot({
    directory: join(target, "backup"),
    source: fixture.source,
    client: fixture.client,
    exportDatabase: (path) => writeFile(path, fixture.sql),
  });
  const restored = await restoreLocal(backup.snapshot, join(target, "restored"));
  return { mode: "fixture-only", backup, restored };
}
