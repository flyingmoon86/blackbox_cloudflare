import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createSnapshot,
  verifySnapshot,
  restoreLocal,
  listAllObjects,
  inspectDatabase,
  restoreSql,
} from "../archive-backup.mjs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { archiveFixture } from "../archive-backup-fixture.mjs";

test("weak response ETags accept matching multipart bytes and reject corrupt bytes", async () => {
  for (const corrupt of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), "blackbox-weak-etag-"));
    const fixture = archiveFixture();
    const etag = (bytes) => createHash("md5").update(createHash("md5").update(bytes).digest()).digest("hex") + "-1";
    const list = fixture.client.list;
    fixture.client.list = async (cursor) => {
      const result = await list(cursor);
      for (const object of result.result) object.etag = etag(fixture.files.get(object.key));
      return result;
    };
    fixture.client.get = async (key) => {
      const bytes = fixture.files.get(key);
      return new Response(corrupt ? Buffer.alloc(bytes.length) : bytes, { headers: { etag: `W/"${etag(bytes)}"` } });
    };
    const promise = createSnapshot({
      directory,
      source: fixture.source,
      client: fixture.client,
      exportDatabase: (path) => writeFile(path, fixture.sql),
    });
    if (corrupt) await assert.rejects(promise, /ETag 校验/);
    else await verifySnapshot((await promise).snapshot);
  }
});

test("D1 export table/data ordering supports forward references but still rejects broken foreign keys", () => {
  const fixture = archiveFixture();
  const prefix =
    "CREATE TABLE export_child(parent_id INTEGER REFERENCES export_parent(id)); INSERT INTO export_child VALUES(1);";
  const suffix = "CREATE TABLE export_parent(id INTEGER PRIMARY KEY); INSERT INTO export_parent VALUES(1);";
  assert.equal(inspectDatabase(prefix + fixture.sql + suffix).foreignKeyErrors, 0);
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("BEGIN; PRAGMA defer_foreign_keys=ON;");
    db.exec(restoreSql(prefix + fixture.sql + suffix));
    db.exec("COMMIT;");
    assert.equal(db.prepare("SELECT parent_id FROM export_child").get().parent_id, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    db.close();
  }
  assert.throws(() => inspectDatabase(prefix + fixture.sql + suffix.replace("VALUES(1)", "VALUES(2)")), /外键错误/);
});

test("archive snapshots verify DB/file references, reuse verified blobs and preserve historical snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "blackbox-archive-test-"));
  const fixture = archiveFixture();
  const options = {
    directory,
    source: fixture.source,
    client: fixture.client,
    exportDatabase: (path) => writeFile(path, fixture.sql),
  };
  const first = await createSnapshot(options);
  assert.equal(first.downloaded, 5);
  const second = await createSnapshot(options);
  assert.equal(second.downloaded, 0);
  assert.equal(second.reused, 5);
  const verified = await verifySnapshot(first.snapshot);
  assert.equal(verified.manifest.database.counts.production_credit, 1);
  assert.equal(verified.manifest.database.references.length, 5);
  assert.ok(verified.manifest.database.rowHashes.production);
  await assert.rejects(restoreLocal(first.snapshot, directory), /恢复目录/);
  const file = verified.manifest.objects[0];
  await writeFile(join(directory, "objects", file.sha256.slice(0, 2), file.sha256), "broken");
  await assert.rejects(verifySnapshot(first.snapshot), /校验失败/);
  await assert.rejects(verifySnapshot(second.snapshot), /校验失败/);
});

test("missing referenced files and changing inventories never produce a completed snapshot", async () => {
  for (const scenario of ["missing", "changing"]) {
    const directory = await mkdtemp(join(tmpdir(), "blackbox-archive-failure-"));
    const fixture = archiveFixture();
    if (scenario === "missing") fixture.files.delete("photo.jpg");
    else {
      const get = fixture.client.get;
      fixture.client.get = async (key) => {
        const response = await get(key);
        fixture.files.set("new-object", Buffer.from("new"));
        return response;
      };
    }
    await assert.rejects(
      createSnapshot({
        directory,
        source: fixture.source,
        client: fixture.client,
        exportDatabase: (path) => writeFile(path, fixture.sql),
      }),
    );
    const snapshot = (await readdir(join(directory, "snapshots")))[0];
    await assert.rejects(readFile(join(directory, "snapshots", snapshot, "complete.json")));
  }
  await assert.rejects(
    listAllObjects({ list: async () => ({ success: true, result: [], result_info: { is_truncated: true } }) }),
    /游标/,
  );
});
