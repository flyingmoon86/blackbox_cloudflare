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

test("photo references include both member stores and archived photos, while pre-feature exports still load", async () => {
  const legacySql = await Promise.all(
    (await readdir("migrations"))
      .filter((name) => name.endsWith(".sql") && Number(name.split("_")[0]) <= 24)
      .sort()
      .map((name) => readFile(join("migrations", name), "utf8")),
  );
  assert.deepEqual(inspectDatabase(legacySql.join("\n")).references, []);

  const fixture = archiveFixture();
  const keys = ["private-active.jpg", "private-archived.jpg", "featured-active.jpg", "featured-archived.jpg"];
  fixture.sql += `
    INSERT INTO member_record(id,member_id,kind,updated_by) VALUES('backup-moment',1,'moment',1);
    INSERT INTO member_record_photo(id,record_id,object_key,status,archived,updated_by) VALUES
      ('private-active','backup-moment','private-active.jpg','approved',0,1),
      ('private-archived','backup-moment','private-archived.jpg','approved',1,1);
    INSERT INTO member_featured_photo(id,member_id,object_key,status,archived,updated_by) VALUES
      ('featured-active',1,'featured-active.jpg','approved',0,1),
      ('featured-archived',1,'featured-archived.jpg','approved',1,1);`;
  // Materialize timestamp defaults and audit triggers once, just like a D1
  // export. Replaying raw INSERTs during verification could cross a second.
  fixture.sql = restoreSql(fixture.sql);
  for (const key of keys) fixture.files.set(key, Buffer.from("synthetic member photo: " + key));
  const references = inspectDatabase(fixture.sql).references;
  for (const key of keys) assert.ok(references.includes(key));
  const directory = await mkdtemp(join(tmpdir(), "blackbox-member-photo-backup-"));
  const options = {
    directory,
    source: fixture.source,
    client: fixture.client,
    exportDatabase: (path) => writeFile(path, fixture.sql),
  };
  const completed = await createSnapshot(options);
  assert.equal((await verifySnapshot(completed.snapshot)).manifest.database.references.length, 9);

  for (const key of keys) {
    const bytes = fixture.files.get(key);
    fixture.files.delete(key);
    const before = new Set(await readdir(join(directory, "snapshots")));
    await assert.rejects(createSnapshot(options), /数据库引用的 1 个文件不在 R2/);
    const failed = (await readdir(join(directory, "snapshots"))).find((name) => !before.has(name));
    await assert.rejects(readFile(join(directory, "snapshots", failed, "complete.json")));
    fixture.files.set(key, bytes);
  }
});

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
