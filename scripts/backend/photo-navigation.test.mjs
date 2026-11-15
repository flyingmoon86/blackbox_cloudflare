import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createDatabase } from "./harness.mjs";
import { PHOTO_NEIGHBORS_SQL } from "../../src/services/resource-queries.ts";

function fixture(maxMigration) {
  const db = createDatabase(maxMigration);
  db.exec(`INSERT INTO production(id,title) VALUES(1,'合成作品'),(2,'另一个作品');
    INSERT INTO production_edition(id,production_id,name) VALUES(3,1,'其他版本');`);
  const insert = db.prepare(`INSERT INTO resource(id,title,filename,production_id,edition_id,status,res_type,created_at)
    VALUES(?,'合成照片','synthetic/'||?,1,1,'approved','photo',?)`);
  db.exec("BEGIN");
  for (let id = 1; id <= 300; id++) insert.run(id, id, `2026-11-${String(1 + (id % 3)).padStart(2, "0")} 12:00:00`);
  db.exec(`COMMIT;
    UPDATE resource SET status='pending' WHERE id%7=0;
    UPDATE resource SET status='rejected' WHERE id%11=0;
    UPDATE resource SET res_type='script' WHERE id%13=0;
    UPDATE resource SET edition_id=3 WHERE id%17=0;
    UPDATE resource SET production_id=2,edition_id=2 WHERE id%19=0;`);
  return db;
}

function verifyAlbum(db, production, edition) {
  const expected = db
    .prepare(
      `SELECT id FROM resource WHERE production_id=? AND edition_id=?
    AND status='approved' AND res_type='photo' ORDER BY created_at DESC,id DESC`,
    )
    .all(production, edition);
  const query = db.prepare(PHOTO_NEIGHBORS_SQL);
  for (const [index, { id }] of expected.entries())
    assert.deepEqual(
      { ...query.get(id, production, edition) },
      {
        previous_id: expected[index - 1]?.id ?? null,
        next_id: expected[index + 1]?.id ?? null,
      },
      `photo ${id}`,
    );
  return expected;
}

test("indexed photo neighbors preserve time/ID order, album boundaries and approved-only membership", () => {
  const db = fixture();
  try {
    for (const [production, edition] of [
      [1, 1],
      [1, 3],
      [2, 2],
    ])
      verifyAlbum(db, production, edition);
    const query = db.prepare(PHOTO_NEIGHBORS_SQL);
    for (const args of [
      [7, 1, 1],
      [11, 1, 1],
      [13, 1, 1],
      [1, 1, 3],
      [1, 2, 1],
      [9999, 1, 1],
    ])
      assert.equal(query.get(...args), undefined);
    db.exec("INSERT INTO resource(id,title,filename,res_type) VALUES(999,'无作品旧照片','synthetic/orphan','photo')");
    assert.equal(query.get(999, 1, 1), undefined);
    db.exec("DELETE FROM resource WHERE id<>1");
    assert.deepEqual({ ...query.get(1, 1, 1) }, { previous_id: null, next_id: null });
    db.exec("DELETE FROM resource WHERE id=1");
    assert.equal(query.get(1, 1, 1), undefined);
  } finally {
    db.close();
  }
});

test("photo navigation reflects approval, revocation, moves, time edits and deletion without stale cache", () => {
  const db = fixture();
  try {
    for (const sql of [
      "UPDATE resource SET status='approved' WHERE id=7",
      "UPDATE resource SET status='pending' WHERE id=1",
      "UPDATE resource SET edition_id=3 WHERE id=2",
      "UPDATE resource SET production_id=2,edition_id=2 WHERE id=3",
      "UPDATE resource SET res_type='script' WHERE id=4",
      "UPDATE resource SET created_at='2026-12-01' WHERE id=5",
      "DELETE FROM resource WHERE id=6",
    ]) {
      db.exec(sql);
      for (const [production, edition] of [
        [1, 1],
        [1, 3],
        [2, 2],
      ])
        verifyAlbum(db, production, edition);
    }
  } finally {
    db.close();
  }
});

test("incremental photo index preserves records and seeks same-time IDs without scanning or sorting", () => {
  const db = fixture(30);
  try {
    const before = db.prepare("SELECT * FROM resource ORDER BY id").all();
    db.exec(readFileSync("migrations/0031_photo_neighbors.sql", "utf8"));
    assert.deepEqual(db.prepare("SELECT * FROM resource ORDER BY id").all(), before);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
    verifyAlbum(db, 1, 1);
    const plan = db
      .prepare("EXPLAIN QUERY PLAN " + PHOTO_NEIGHBORS_SQL)
      .all(150, 1, 1)
      .map((x) => x.detail);
    assert.ok(
      plan.some((x) => /created_at=\? AND id>\?/.test(x)),
      plan.join("\n"),
    );
    assert.ok(
      plan.some((x) => /created_at=\? AND id<\?/.test(x)),
      plan.join("\n"),
    );
    assert.equal(plan.filter((x) => x.includes("ix_resource_approved_photo_order")).length, 4);
    assert.ok(
      plan.every((x) => !/SCAN |TEMP B-TREE/.test(x)),
      plan.join("\n"),
    );
  } finally {
    db.close();
  }
});
