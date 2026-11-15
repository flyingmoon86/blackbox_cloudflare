import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createDatabase } from "./backend/harness.mjs";
import { PHOTO_NEIGHBORS_SQL } from "../src/services/resource-queries.ts";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const output = process.argv[2];
if (!output) throw Error("Usage: node scripts/measure-photo-navigation.mjs OUTPUT.json");
// Production query before this fix; retained only as the experiment's baseline.
const beforeSql = `WITH photos AS (
  SELECT id,LAG(id) OVER (ORDER BY created_at DESC,id DESC) previous_id,
    LEAD(id) OVER (ORDER BY created_at DESC,id DESC) next_id,
    ROW_NUMBER() OVER (ORDER BY created_at DESC,id DESC) position,COUNT(*) OVER () total
  FROM resource WHERE production_id=? AND edition_id=? AND status='approved' AND res_type='photo'
) SELECT previous_id,next_id,position,total FROM photos WHERE id=?`;
function measure(statement, args) {
  for (let i = 0; i < 5; i++) statement.get(...args);
  const samples = [];
  for (let i = 0; i < 25; i++) {
    const start = performance.now();
    statement.get(...args);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return { medianMs: samples[12], p95Ms: samples[23] };
}
const results = [];
for (const size of [100, 1000, 10000]) {
  for (const timestamps of ["all-tied", "ten-groups"]) {
    const db = createDatabase(30);
    try {
      db.exec("INSERT INTO production(id,title) VALUES(1,'合成相册'); BEGIN");
      const insert =
        db.prepare(`INSERT INTO resource(id,production_id,edition_id,title,filename,status,res_type,created_at)
        VALUES(?,1,1,'合成照片','synthetic/'||?,'approved',?,?)`);
      for (let id = 1; id <= size; id++)
        insert.run(
          id,
          id,
          "photo",
          `2026-11-${String(timestamps === "all-tied" ? 1 : 1 + (id % 10)).padStart(2, "0")} 12:00:00`,
        );
      // Non-photos interleaved with the album must not make the seeks expensive.
      for (let id = size + 1; id <= size * 2; id++) insert.run(id, id, "script", "2026-11-01 12:00:00");
      db.exec("COMMIT; ANALYZE");
      const beforeQuery = db.prepare(beforeSql);
      const samples = [1, Math.floor(size / 2), size].map((id) => ({
        id,
        expected: beforeQuery.get(1, 1, id),
        before: measure(beforeQuery, [1, 1, id]),
      }));
      const beforePlan = db
        .prepare("EXPLAIN QUERY PLAN " + beforeSql)
        .all(1, 1, samples[1].id)
        .map((x) => x.detail);
      db.exec(readFileSync("migrations/0031_photo_neighbors.sql", "utf8"));
      db.exec("ANALYZE");
      const afterQuery = db.prepare(PHOTO_NEIGHBORS_SQL);
      for (const sample of samples) {
        const actual = afterQuery.get(sample.id, 1, 1);
        assert.deepEqual({ ...actual }, { previous_id: sample.expected.previous_id, next_id: sample.expected.next_id });
        const after = measure(afterQuery, [sample.id, 1, 1]);
        const afterPlan = db
          .prepare("EXPLAIN QUERY PLAN " + PHOTO_NEIGHBORS_SQL)
          .all(sample.id, 1, 1)
          .map((x) => x.detail);
        assert.ok(
          afterPlan.every((x) => !/SCAN |TEMP B-TREE/.test(x)),
          afterPlan.join("\n"),
        );
        results.push({
          size,
          timestamps,
          id: sample.id,
          equalNeighbors: true,
          before: sample.before,
          after,
          beforePlan,
          afterPlan,
        });
      }
    } finally {
      db.close();
    }
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  scope: "Local in-memory SQLite with synthetic full schema; not production D1 rows_read, latency or billing",
  node: process.version,
  sqlite: process.versions.sqlite,
  method: {
    warmup: 5,
    samples: 25,
    realMigrations: true,
    preparedStatements: true,
    extraNonPhotosPerAlbum: "same as photo count",
  },
  results,
};
// D1's local runtime reports rows_read as well as SQLite timing. Use the real
// resource table/index definitions; parent stubs only satisfy foreign keys.
const schema = createDatabase(30);
const resourceSchema = schema
  .prepare(
    "SELECT sql FROM sqlite_master WHERE tbl_name='resource' AND type IN ('table','index') AND sql IS NOT NULL ORDER BY type DESC",
  )
  .all()
  .map((x) => x.sql);
schema.close();
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: "photo-navigation-measurement",
        modules: true,
        script: 'export default { fetch() { return new Response("synthetic fixture") } }',
        compatibilityDate: "2026-09-08",
        d1Databases: ["DB"],
      },
    ],
  }),
);
report.localD1 = [];
try {
  const db = await mf.getD1Database("DB");
  for (const table of ["production", "production_edition", "user"])
    await db.prepare(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY)`).run();
  await db.batch([
    db.prepare("INSERT INTO production VALUES(1)"),
    db.prepare("INSERT INTO production_edition VALUES(1)"),
    ...resourceSchema.map((sql) => db.prepare(sql)),
  ]);
  for (const size of [100, 1000, 10000]) {
    for (const timestamps of ["all-tied", "ten-groups"]) {
      await db.prepare("DROP INDEX IF EXISTS ix_resource_approved_photo_order").run();
      await db.prepare("DELETE FROM resource").run();
      await db
        .prepare(
          `WITH RECURSIVE x(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM x WHERE n<?)
        INSERT INTO resource(id,production_id,edition_id,title,filename,status,res_type,created_at)
        SELECT n,1,1,'合成资料','synthetic/'||n,'approved',CASE WHEN n<=? THEN 'photo' ELSE 'script' END,
          printf('2026-11-%02d 12:00:00',CASE WHEN ?='all-tied' THEN 1 ELSE 1+n%10 END) FROM x`,
        )
        .bind(size * 2, size, timestamps)
        .run();
      const before = [];
      for (const id of [1, Math.floor(size / 2), size])
        before.push({ id, response: await db.prepare(beforeSql).bind(1, 1, id).all() });
      await db.prepare(readFileSync("migrations/0031_photo_neighbors.sql", "utf8")).run();
      for (const { id, response } of before) {
        const after = await db.prepare(PHOTO_NEIGHBORS_SQL).bind(id, 1, 1).all();
        assert.deepEqual(after.results[0], {
          previous_id: response.results[0].previous_id,
          next_id: response.results[0].next_id,
        });
        assert.ok(after.meta.rows_read <= 6, `bounded local D1 reads: ${JSON.stringify(after.meta)}`);
        report.localD1.push({
          size,
          timestamps,
          id,
          beforeRowsRead: response.meta.rows_read,
          afterRowsRead: after.meta.rows_read,
          afterRowsWritten: after.meta.rows_written,
        });
      }
    }
  }
} finally {
  await mf.dispose();
}
report.scope += "; local D1 rows_read uses resource schema/indexes with synthetic data and parent stubs";
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    output: resolve(output),
    samples: results.length,
    beforeMedianMs: results.map((x) => x.before.medianMs),
    afterMedianMs: results.map((x) => x.after.medianMs),
    localD1: report.localD1,
  }),
);
