import assert from "node:assert/strict";
import { creditFixture } from "./credit-import-fixture.mjs";

// Counts binding round trips separately from statements inside an atomic D1 batch.
function instrument(env) {
  const counts = { d1Trips: 0, d1Statements: 0, r2: {} };
  const db = env.DB;
  const originals = new WeakMap();
  const wrap = (statement) => {
    const tracked = { bind: (...args) => wrap(statement.bind(...args)) };
    for (const method of ["first", "all", "run", "raw"])
      tracked[method] = (...args) => {
        counts.d1Trips++;
        counts.d1Statements++;
        return statement[method](...args);
      };
    originals.set(tracked, statement);
    return tracked;
  };
  env.DB = {
    prepare: (sql) => wrap(db.prepare(sql)),
    batch: (statements) => {
      counts.d1Trips++;
      counts.d1Statements += statements.length;
      return db.batch(statements.map((statement) => originals.get(statement)));
    },
  };
  const countCall = (target, name, args) => {
    counts.r2[name] = (counts.r2[name] || 0) + 1;
    return target[name](...args);
  };
  const multipart = (task) =>
    Object.fromEntries(
      ["uploadPart", "complete", "abort"].map((name) => [name, (...args) => countCall(task, name, args)]),
    );
  const files = env.FILES;
  env.FILES = {
    ...files,
    ...Object.fromEntries(
      ["head", "get", "put", "list", "delete"].map((name) => [name, (...args) => countCall(files, name, args)]),
    ),
    async createMultipartUpload(...args) {
      const task = await countCall(files, "createMultipartUpload", args);
      return { ...task, ...multipart(task) };
    },
    resumeMultipartUpload(...args) {
      const task = files.resumeMultipartUpload(...args);
      return { ...task, ...multipart(task) };
    },
  };
  return counts;
}

export async function measureUploadScenario(type, user = 1) {
  const s = await creditFixture();
  try {
    s.db.exec(
      "UPDATE storage_budget SET initialized=1; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000) INSERT INTO resource(title,filename,status) SELECT 'synthetic-'||x,'old/'||x,'approved' FROM n;",
    );
    const queryPlan = s.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT id FROM resource WHERE filename=? AND source_upload_task_id IS NULL ORDER BY id LIMIT 1",
      )
      .all("new/file")
      .map((r) => r.detail);
    const counts = instrument(s.env);
    const snapshot = () => structuredClone(counts);
    const difference = (before) => ({
      d1Trips: counts.d1Trips - before.d1Trips,
      d1Statements: counts.d1Statements - before.d1Statements,
      r2: Object.fromEntries(
        Object.entries(counts.r2)
          .map(([k, v]) => [k, v - (before.r2[k] || 0)])
          .filter(([, v]) => v),
      ),
    });
    const stages = {};
    const perform = async (name, action, expected = 200) => {
      const before = snapshot();
      const response = await action();
      assert.equal(response.status, expected, `${name}: ${await response.clone().text()}`);
      stages[name] = difference(before);
      return response.json();
    };
    const bytes =
      type === "photo"
        ? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(120).fill(0)])
        : new TextEncoder().encode(type === "script" ? "%PDF-1.4\nsynthetic" : "synthetic upload");
    const name = { photo: "synthetic.png", script: "synthetic.pdf", audio: "synthetic.mp3", other: "synthetic.txt" }[
      type
    ];
    const mime = { photo: "image/png", script: "application/pdf", audio: "audio/mpeg", other: "text/plain" }[type];
    const headers = { "x-csrf-token": "credit-csrf" };
    const task = await perform(
      "create",
      () =>
        s.req(user, "/api/uploads", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            title: "合成测量",
            originalName: name,
            resType: type,
            contentType: mime,
            sizeBytes: bytes.length,
            productionId: 10,
            editionId: 30,
          }),
        }),
      201,
    );
    if (type === "photo")
      await perform("preview", () =>
        s.req(user, `/api/uploads/${task.id}/preview`, {
          method: "PUT",
          headers: { ...headers, "content-type": "image/jpeg" },
          body: new Uint8Array([255, 216, 255, 217]),
        }),
      );
    await perform("part", () =>
      s.req(user, `/api/uploads/${task.id}/parts/1`, { method: "PUT", headers, body: bytes }),
    );
    const result = await perform("complete", () =>
      s.req(user, `/api/uploads/${task.id}/complete`, { method: "POST", headers }),
    );
    assert.equal(result.status, user === 1 ? "approved" : "pending");
    const total = snapshot();
    const replay = await perform("repeatComplete", () =>
      s.req(user, `/api/uploads/${task.id}/complete`, { method: "POST", headers }),
    );
    assert.equal(replay.resourceId, result.resourceId);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE source_upload_task_id=?").get(task.id).n, 1);
    assert.equal(s.db.prepare("SELECT reserved_bytes FROM storage_budget WHERE id=1").get().reserved_bytes, 0);
    return { type, user: user === 1 ? "admin" : "member", stages, total, queryPlan };
  } finally {
    s.db.close();
  }
}
