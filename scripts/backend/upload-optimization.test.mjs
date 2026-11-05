import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { creditFixture } from "./credit-import-fixture.mjs";
import { createDatabase } from "./harness.mjs";
import { measureUploadScenario } from "./upload-performance-fixture.mjs";

const bytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 255, 217]);
const headers = { "x-csrf-token": "credit-csrf" };
async function setup(user = 2) {
  const s = await creditFixture();
  s.db.exec("UPDATE storage_budget SET initialized=1");
  const response = await s.req(user, "/api/uploads", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      title: "测试资料",
      originalName: "sample.jpg",
      resType: "photo",
      contentType: "image/jpeg",
      productionId: 10,
      editionId: 30,
      sizeBytes: bytes.length,
    }),
  });
  assert.equal(response.status, 201);
  const task = await response.json();
  const path = `/api/uploads/${task.id}`;
  return {
    ...s,
    task,
    path,
    put: () => s.req(user, path + "/parts/1", { method: "PUT", headers, body: bytes }),
    complete: () => s.req(user, path + "/complete", { method: "POST", headers }),
  };
}

test("upload query budgets improve for all four file types and both member/admin roles", async () => {
  for (const user of [1, 2])
    for (const type of ["photo", "script", "audio", "other"]) {
      const result = await measureUploadScenario(type, user);
      assert.ok(result.total.d1Trips <= (type === "photo" ? 25 : 21), JSON.stringify(result));
      assert.equal(result.total.r2.head, 2);
      assert.equal(result.total.r2.get, 1, "content validation must remain");
      assert.ok(result.queryPlan.some((p) => p.includes("ix_resource_filename")));
      assert.deepEqual(result.stages.repeatComplete.r2, {});
    }
});

test("filename index upgrade preserves duplicate/shared legacy rows and uses indexed lookup", () => {
  const db = createDatabase(27);
  try {
    db.exec("INSERT INTO resource(id,title,filename) VALUES(7,'历史甲','shared/key'),(9,'历史乙','shared/key');");
    const before = db.prepare("SELECT * FROM resource ORDER BY id").all();
    db.exec(readFileSync("migrations/0028_resource_filename_lookup.sql", "utf8"));
    assert.deepEqual(db.prepare("SELECT * FROM resource ORDER BY id").all(), before);
    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM resource WHERE filename=? AND source_upload_task_id IS NULL ORDER BY id LIMIT 1",
      )
      .all("shared/key");
    assert.ok(plan.some((r) => r.detail.includes("ix_resource_filename")));
  } finally {
    db.close();
  }
});

test("existing direct tasks retain authorized, idempotent part acknowledgements", async () => {
  const s = await setup();
  try {
    s.db.prepare("UPDATE upload_task SET upload_mode='direct' WHERE id=?").run(s.task.id);
    const acknowledge = (user, size = bytes.length) =>
      s.req(user, s.path + "/parts/1/complete", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ etag: "synthetic-direct-etag", sizeBytes: size }),
      });
    assert.equal((await acknowledge(3)).status, 404);
    assert.equal((await acknowledge(2, 1)).status, 400);
    assert.equal((await acknowledge(2)).status, 200);
    assert.equal((await acknowledge(2)).status, 200);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM upload_part").get().n, 1);
    assert.equal(s.db.prepare("SELECT lease_token FROM upload_task").get().lease_token, null);
  } finally {
    s.db.close();
  }
});

test("part metadata and lease release roll back together and allow a retry", async () => {
  const s = await setup();
  try {
    s.db.exec(
      "CREATE TRIGGER fail_part_unlock BEFORE UPDATE OF lease_token ON upload_task WHEN NEW.lease_token IS NULL AND EXISTS(SELECT 1 FROM upload_part WHERE task_id=NEW.id) BEGIN SELECT RAISE(ABORT,'synthetic unlock failure'); END;",
    );
    assert.equal((await s.put()).status, 500);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM upload_part").get().n, 0);
    assert.equal(s.db.prepare("SELECT lease_token FROM upload_task").get().lease_token, null);
    s.db.exec("DROP TRIGGER fail_part_unlock");
    assert.equal((await s.put()).status, 200);
    assert.equal((await s.complete()).status, 200);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
  } finally {
    s.db.close();
  }
});

test("a stale part or preview cannot overwrite progress or release a successor lease", async () => {
  for (const preview of [false, true]) {
    const s = await setup();
    try {
      if (preview) {
        const put = s.env.FILES.put;
        s.env.FILES.put = async (...args) => {
          const result = await put(...args);
          s.db.prepare("UPDATE upload_task SET lease_token='successor' WHERE id=?").run(s.task.id);
          return result;
        };
      } else {
        const resume = s.env.FILES.resumeMultipartUpload;
        s.env.FILES.resumeMultipartUpload = (...args) => {
          const task = resume(...args);
          return {
            ...task,
            async uploadPart(...partArgs) {
              const result = await task.uploadPart(...partArgs);
              s.db.prepare("UPDATE upload_task SET lease_token='successor' WHERE id=?").run(s.task.id);
              return result;
            },
          };
        };
      }
      const response = preview
        ? await s.req(2, s.path + "/preview", {
            method: "PUT",
            headers: { ...headers, "content-type": "image/jpeg" },
            body: bytes,
          })
        : await s.put();
      assert.equal(response.status, 409);
      assert.equal(s.db.prepare("SELECT lease_token FROM upload_task").get().lease_token, "successor");
      assert.equal(s.db.prepare("SELECT COUNT(*) n FROM upload_part").get().n, 0);
      assert.equal(s.db.prepare("SELECT preview_filename FROM upload_task").get().preview_filename, "");
    } finally {
      s.db.close();
    }
  }
});

test("lost R2 completion and lost D1 commit responses recover without duplicate resources", async () => {
  for (const fault of ["r2", "d1"]) {
    const s = await setup(1);
    try {
      await s.put();
      if (fault === "r2") {
        const resume = s.env.FILES.resumeMultipartUpload;
        s.env.FILES.resumeMultipartUpload = (...args) => {
          const task = resume(...args);
          return {
            ...task,
            async complete(parts) {
              await task.complete(parts);
              throw Error("synthetic lost R2 response");
            },
          };
        };
      } else {
        const batch = s.env.DB.batch;
        s.env.DB.batch = async (statements) => {
          await batch(statements);
          throw Error("synthetic lost D1 response");
        };
      }
      assert.equal((await s.complete()).status, fault === "r2" ? 200 : 500);
      const repeated = await s.complete();
      assert.equal(repeated.status, 200);
      assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 1);
      assert.equal(s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_type='resource'").get().n, 1);
      assert.equal(s.db.prepare("SELECT lease_token FROM upload_task").get().lease_token, null);
      assert.equal(s.db.prepare("SELECT reserved_bytes FROM storage_budget").get().reserved_bytes, 0);
    } finally {
      s.db.close();
    }
  }
});

test("legacy recovery attaches only the earliest matching record and preserves shared records", async () => {
  const s = await setup();
  try {
    const key = s.db.prepare("SELECT object_key FROM upload_task").get().object_key;
    s.db
      .prepare(
        "INSERT INTO resource(id,title,filename,status,uploader_id) VALUES(10,'保留原记录',?,'approved',2),(11,'共享记录',?,'approved',2)",
      )
      .run(key, key);
    await s.put();
    const response = await s.complete();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).resourceId, 10);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 2);
    assert.equal(
      s.db.prepare("SELECT source_upload_task_id FROM resource WHERE id=10").get().source_upload_task_id,
      s.task.id,
    );
    assert.equal(
      s.db.prepare("SELECT source_upload_task_id FROM resource WHERE id=11").get().source_upload_task_id,
      null,
    );
  } finally {
    s.db.close();
  }
});

test("completed task lookup still denies an owner after its resource moves into a hidden work", async () => {
  const s = await setup();
  try {
    await s.put();
    await s.complete();
    s.db.exec(
      "UPDATE production SET is_hidden=1 WHERE id=20; UPDATE resource SET production_id=20,edition_id=(SELECT id FROM production_edition WHERE production_id=20 LIMIT 1)",
    );
    s.env.FILES.head = () => assert.fail("unauthorized storage read");
    s.env.FILES.get = () => assert.fail("unauthorized storage read");
    assert.equal((await s.req(2, s.path)).status, 404);
    assert.equal((await s.complete()).status, 404);
    assert.equal((await s.req(1, s.path)).status, 404, "an admin still cannot take over another owner's task");
  } finally {
    s.db.close();
  }
});
