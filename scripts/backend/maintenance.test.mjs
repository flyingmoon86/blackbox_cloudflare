import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadModule, fakeBucket } from "./harness.mjs";
const { cleanExpiredUploads } = await loadModule("src/storage/cleanup.ts");
const { runMaintenance } = await loadModule("src/services/maintenance.ts");

function setup() {
  const db = createDatabase();
  db.exec(
    "UPDATE storage_budget SET initialized=1; INSERT INTO user(id,username,password_hash) VALUES(1,'maintenance','fixture')",
  );
  const env = { DB: d1(db), FILES: fakeBucket(), ENVIRONMENT: "development" };
  // D1 serializes transactions; the in-memory harness needs the same queue.
  const batch = env.DB.batch;
  let queue = Promise.resolve();
  env.DB.batch = (statements) => {
    const result = queue.then(() => batch(statements));
    queue = result.catch(() => {});
    return result;
  };
  return { db, env };
}

test("cleanup drains multiple batches while preserving referenced files and an elapsed work budget", async () => {
  const { db, env } = setup();
  for (let id = 0; id < 55; id++) {
    const key = `cleanup-${id}`;
    await env.FILES.put(key, new Uint8Array([1, 2, 3]));
    db.prepare("INSERT INTO file_cleanup_task(object_key) VALUES(?)").run(key);
  }
  db.exec("INSERT INTO resource(title,filename) VALUES('retained','cleanup-0')");
  await cleanExpiredUploads(env, Date.now() - 1);
  assert.equal(env.FILES.objects.size, 55);
  const result = await cleanExpiredUploads(env);
  assert.equal(result.failed, 0);
  assert.equal(env.FILES.objects.size, 1);
  assert.ok(await env.FILES.head("cleanup-0"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM file_cleanup_task").get().n, 1);
  db.close();
});

test("scheduled jobs report failures, retain successful timestamps and clean more than one import batch", async () => {
  const { db, env } = setup();
  for (let id = 0; id < 45; id++)
    db.prepare(
      "INSERT INTO credit_import_batch(id,actor_name,production_title,edition_label,template_version,original_name,file_sha256,created_at) VALUES(?,'fixture','play','edition',2,'fixture.xlsx',?,'2000-01-01')",
    ).run(`batch-${id}`, `hash-${id}`);
  await runMaintenance(env);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM credit_import_batch WHERE details_purged=1").get().n, 45);
  const success = db
    .prepare("SELECT last_success_at FROM maintenance_status WHERE job='uploads'")
    .get().last_success_at;
  assert.ok(success);
  await env.FILES.put("failed", new Uint8Array([1]));
  db.exec("INSERT INTO file_cleanup_task(object_key) VALUES('failed')");
  const remove = env.FILES.delete;
  env.FILES.delete = async () => {
    throw Error("fixture-private-error");
  };
  await runMaintenance(env);
  const row = db.prepare("SELECT * FROM maintenance_status WHERE job='uploads'").get();
  assert.equal(row.status, "partial");
  assert.equal(row.failure_count, 1);
  assert.equal(row.last_success_at, success);
  assert.equal(db.prepare("SELECT attempts FROM file_cleanup_task").get().attempts, 1);
  env.FILES.delete = remove;
  db.exec("UPDATE file_cleanup_task SET next_attempt_at='2000-01-01'");
  await runMaintenance(env);
  assert.equal(db.prepare("SELECT status FROM maintenance_status WHERE job='uploads'").get().status, "ok");
  assert.equal(await env.FILES.head("failed"), null);
  db.close();
});
