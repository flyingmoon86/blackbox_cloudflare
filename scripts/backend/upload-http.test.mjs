import assert from "node:assert/strict";
import test from "node:test";
import { readUploadResponse, retryUpload } from "../../src/client/shared/upload-http.js";

test("upload response parsing retains status, Retry-After, optional missing and endpoint messages", async () => {
  assert.deepEqual(await readUploadResponse(Response.json({ id: "task" })), { id: "task" });
  assert.equal(await readUploadResponse(new Response(null, { status: 404 }), { optionalNotFound: true }), null);
  await assert.rejects(
    readUploadResponse(Response.json({ error: "限额" }, { status: 429, headers: { "Retry-After": "60" } })),
    (e) => e.status === 429 && e.retryAfter === 60 && e.message === "限额" && !e.retryable,
  );
  await assert.rejects(
    readUploadResponse(Response.json({ error: "denied" }, { status: 403 }), { authMessage: "请重新登录" }),
    /请重新登录/,
  );
  await assert.rejects(
    readUploadResponse(Response.json({}, { status: 500 }), { failureMessage: (s) => `故障 ${s}` }),
    /故障 500/,
  );
});
test("upload retry handles network and 5xx with bounded endpoint-specific backoff", async () => {
  for (const delayMs of [650, 800]) {
    let calls = 0;
    const waits = [];
    const result = await retryUpload(
      async () => {
        calls++;
        if (calls === 1) throw new TypeError("network");
        if (calls === 2) return readUploadResponse(Response.json({ error: "temporary" }, { status: 503 }));
        return "done";
      },
      { delayMs, sleep: async (ms) => waits.push(ms) },
    );
    assert.equal(result, "done");
    assert.equal(calls, 3);
    assert.deepEqual(waits, [delayMs, delayMs * 2]);
    calls = 0;
    await assert.rejects(
      retryUpload(
        () => {
          calls++;
          throw new TypeError("offline");
        },
        { sleep: async () => {} },
      ),
      /offline/,
    );
    assert.equal(calls, 3);
  }
});
test("auth, redirect, abort, 4xx and malformed success never replay a write", async () => {
  const redirected = Response.json({});
  Object.defineProperty(redirected, "redirected", { value: true });
  for (const action of [
    () => readUploadResponse(redirected),
    () => readUploadResponse(new Response("<html>login</html>")),
    () => readUploadResponse(Response.json(null)),
    ...[400, 401, 403, 404, 409, 413, 429].map(
      (status) => () => readUploadResponse(Response.json({ error: "stop" }, { status })),
    ),
    () => {
      throw new DOMException("cancelled", "AbortError");
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      retryUpload(
        () => {
          calls++;
          return action();
        },
        {
          sleep: async () => {
            throw Error("must not wait");
          },
        },
      ),
    );
    assert.equal(calls, 1);
  }
});
