import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "./backend/harness.mjs";
import { createSnapshot, restoreLocal } from "./archive-backup.mjs";

const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const literal = (value) =>
  value === null ? "NULL" : typeof value === "number" ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";

export function archiveFixture({ privateRecords = false } = {}) {
  const db = createDatabase();
  db.exec(`INSERT INTO member(id,name,photo,avatar_preview) VALUES(1,'恢复演练队员','avatar.jpg','avatar-small.jpg');
    INSERT INTO user(id,username,password_hash,role) VALUES(1,'restore-fixture','fixture-only','admin');
    INSERT INTO production(id,title,year) VALUES(1,'恢复演练作品',2026);
    INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) SELECT 1,id,1,'cast','演员' FROM production_edition WHERE production_id=1;
    INSERT INTO resource(production_id,edition_id,title,res_type,filename,preview_filename) SELECT 1,id,'恢复演练剧照','photo','photo.jpg','preview.jpg' FROM production_edition WHERE production_id=1;
    INSERT INTO resource(title,res_type,filename) VALUES('恢复演练剧本','script','script.pdf');`);
  if (privateRecords)
    db.exec(`
      INSERT INTO member_record(id,member_id,kind,graduation_year,knowledge,destination_type,details,updated_by)
        VALUES('fixture-destination',1,'destination',2026,'provided','employment','{"employer":"合成演练单位"}',1);
      UPDATE member_record SET details='{"employer":"合成演练单位修订"}',version=version+1,action='edit'
        WHERE id='fixture-destination';
      INSERT INTO member_record(id,member_id,kind,title,updated_by)
        VALUES('fixture-moment',1,'moment','合成私密记录',1);
      INSERT INTO member_record_photo(id,record_id,object_key,status,archived,updated_by) VALUES
        ('fixture-private-active','fixture-moment','private-active.jpg','approved',0,1),
        ('fixture-private-archived','fixture-moment','private-archived.jpg','approved',1,1);
      INSERT INTO member_featured_photo(id,member_id,object_key,caption,status,members_consent,archived,updated_by) VALUES
        ('fixture-featured-active',1,'featured-active.jpg','合成精选照片','approved',1,0,1),
        ('fixture-featured-archived',1,'featured-archived.jpg','合成归档照片','approved',0,1,1);
    `);
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
  const fileKeys = ["avatar.jpg", "avatar-small.jpg", "photo.jpg", "preview.jpg", "script.pdf"];
  if (privateRecords)
    fileKeys.push("private-active.jpg", "private-archived.jpg", "featured-active.jpg", "featured-archived.jpg");
  const files = new Map(fileKeys.map((key) => [key, Buffer.from("archive fixture bytes: " + key)]));
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
  const fixture = archiveFixture({ privateRecords: true });
  const backup = await createSnapshot({
    directory: join(target, "backup"),
    source: fixture.source,
    client: fixture.client,
    exportDatabase: (path) => writeFile(path, fixture.sql),
  });
  const restored = await restoreLocal(backup.snapshot, join(target, "restored"));
  return { mode: "fixture-only", backup, restored };
}
