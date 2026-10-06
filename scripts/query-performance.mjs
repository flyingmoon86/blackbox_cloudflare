import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { EDITION_RESOURCES_SQL, EDITION_RESOURCE_COUNT_SQL } from "../src/services/resource-queries.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2];
if (!out) throw Error("Usage: node scripts/query-performance.mjs OUTPUT.json");
const sha = (x) => createHash("sha256").update(x).digest("hex");
const migrations = readdirSync(join(root, "migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort();
const indexName = migrations.find((x) => x.endsWith("_resource_edition_order.sql"));
assert.ok(indexName);
const indexSql = readFileSync(join(root, "migrations", indexName), "utf8");
const querySource = readFileSync(join(root, "src/services/resource-queries.ts"), "utf8");
const dbs = [new DatabaseSync(":memory:"), new DatabaseSync(":memory:")];
const rowCount = 30000,
  productions = 30,
  editionsPerProduction = 5;
function seed(db) {
  db.exec("PRAGMA foreign_keys=ON; BEGIN");
  for (const name of migrations.filter((x) => x !== indexName))
    db.exec(readFileSync(join(root, "migrations", name), "utf8"));
  const p = db.prepare("INSERT INTO production(id,title,year) VALUES(?,?,2025)");
  const e = db.prepare("INSERT INTO production_edition(production_id,name,year) VALUES(?,?,?)");
  for (let n = 1; n <= productions; n++) {
    p.run(n, "合成作品 " + n);
    for (let v = 1; v < editionsPerProduction; v++) e.run(n, "合成版本 " + v, 2020 + v);
  }
  const editions = db.prepare("SELECT id,production_id FROM production_edition ORDER BY id").all();
  const insert = db.prepare(
    "INSERT INTO resource(production_id,edition_id,status,title,res_type,filename,original_name,preview_filename,description,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
  );
  for (let n = 0; n < rowCount; n++) {
    const ed = editions[n % editions.length];
    const d = new Date(Date.UTC(2025, 0, 1 + ((n * 17) % 365))).toISOString().replace("T", " ").slice(0, 19);
    insert.run(
      ed.production_id,
      ed.id,
      n % 7 === 0 ? "pending" : "approved",
      "合成资料 " + n,
      n % 3 === 0 ? "photo" : "script",
      "synthetic/" + n,
      "file-" + n + ".pdf",
      "",
      "仅供可复现实验，不是真实资料",
      d,
    );
  }
  db.exec("COMMIT; ANALYZE");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
}
const percentile = (a, q) => [...a].sort((a, b) => a - b)[Math.ceil(a.length * q) - 1];
const stats = (a) => ({ medianMs: percentile(a, 0.5), p95Ms: percentile(a, 0.95), samples: a });
try {
  for (const db of dbs) seed(db);
  const beforePages = dbs[1].prepare("PRAGMA page_count").get().page_count;
  dbs[1].exec(indexSql + "\nANALYZE");
  const addedPages = dbs[1].prepare("PRAGMA page_count").get().page_count - beforePages;
  const pageSize = dbs[1].prepare("PRAGMA page_size").get().page_size;
  const cases = [
    { name: "作品版本资料第一页", sql: EDITION_RESOURCES_SQL, args: [1, 1, 24, 0] },
    { name: "作品版本资料第五页", sql: EDITION_RESOURCES_SQL, args: [1, 1, 24, 96] },
    { name: "作品版本资料总数", sql: EDITION_RESOURCE_COUNT_SQL, args: [1, 1] },
  ];
  const results = [];
  for (const c of cases) {
    const statements = dbs.map((db) => db.prepare(c.sql));
    const rows = statements.map((s) => s.all(...c.args));
    assert.deepEqual(rows[0], rows[1]);
    for (let i = 0; i < 20; i++) for (const s of statements) s.all(...c.args);
    const samples = [[], []];
    for (let n = 0; n < 80; n++)
      for (const i of n % 2 ? [1, 0] : [0, 1]) {
        const t = performance.now();
        for (let b = 0; b < 10; b++) statements[i].all(...c.args);
        samples[i].push((performance.now() - t) / 10);
      }
    const measured = dbs.map((db, i) => ({
      ...stats(samples[i]),
      plan: db
        .prepare("EXPLAIN QUERY PLAN " + c.sql)
        .all(...c.args)
        .map((x) => x.detail),
    }));
    results.push({
      ...c,
      rowCount: rows[0].length,
      resultSha256: sha(JSON.stringify(rows[0])),
      equal: true,
      before: measured[0],
      after: measured[1],
      medianSpeedup: measured[0].medianMs / measured[1].medianMs,
    });
  }
  // Check all pages, timestamp ties, empty pages, and mismatched production/edition filters.
  let equalityChecks = 0;
  for (const p of [1, 2, 30, 999])
    for (const e of [1, 5, 6, 150, 999])
      for (const offset of [0, 24, 96, 192, 240]) {
        assert.deepEqual(
          dbs[0].prepare(EDITION_RESOURCES_SQL).all(p, e, 24, offset),
          dbs[1].prepare(EDITION_RESOURCES_SQL).all(p, e, 24, offset),
        );
        equalityChecks++;
      }
  // Each write sample rolls back. Time is the transaction plus 200 inserts and rollback.
  const writeSamples = [[], []];
  for (let n = 0; n < 22; n++)
    for (const i of n % 2 ? [1, 0] : [0, 1]) {
      const db = dbs[i];
      const insert = db.prepare(
        "INSERT INTO resource(production_id,edition_id,status,title,res_type,filename,created_at) VALUES(1,1,'approved','write test','other',?,'2026-01-01')",
      );
      const t = performance.now();
      db.exec("BEGIN");
      for (let k = 0; k < 200; k++) insert.run("write/" + k);
      db.exec("ROLLBACK");
      if (n >= 2) writeSamples[i].push(performance.now() - t);
    }
  const report = {
    generatedAt: new Date().toISOString(),
    scope: "local in-memory SQLite; synthetic full schema, not production latency",
    node: process.version,
    sqlite: process.versions.sqlite,
    platform: process.platform,
    data: { rows: rowCount, productions, editions: productions * editionsPerProduction },
    method: {
      warmup: 20,
      samples: 80,
      queriesPerSample: 10,
      alternatingOrder: true,
      analyzeBoth: true,
      preparedStatements: true,
    },
    querySourceSha256: sha(querySource),
    migration: indexName,
    indexSql,
    results,
    equalityChecks,
    indexAllocatedBytes: addedPages * pageSize,
    write200TransactionMs: { before: stats(writeSamples[0]), after: stats(writeSamples[1]) },
    foreignKeyErrors: dbs.map((db) => db.prepare("PRAGMA foreign_key_check").all().length),
    sources: ["https://www.sqlite.org/queryplanner.html", "https://www.sqlite.org/eqp.html"],
  };
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(
    JSON.stringify(
      {
        output: resolve(out),
        equalityChecks,
        indexAllocatedBytes: report.indexAllocatedBytes,
        results: results.map((x) => ({
          name: x.name,
          beforeMs: x.before.medianMs,
          afterMs: x.after.medianMs,
          speedup: x.medianSpeedup,
          beforePlan: x.before.plan,
          afterPlan: x.after.plan,
        })),
        writeBefore: report.write200TransactionMs.before.medianMs,
        writeAfter: report.write200TransactionMs.after.medianMs,
      },
      null,
      2,
    ),
  );
} finally {
  for (const db of dbs) db.close();
}
