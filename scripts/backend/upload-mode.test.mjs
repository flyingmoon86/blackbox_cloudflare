import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, fakeBucket, loadModule, loadWorker, context } from "./harness.mjs";

const { usesDirectR2, uploadModeConfiguration, presignDirectPart } = await loadModule("src/storage/r2-s3.ts");
const { createSession } = await loadModule("src/auth/session.ts");
const worker = await loadWorker();
const credentials = {
  R2_ACCOUNT_ID: "fixture-account",
  R2_ACCESS_KEY_ID: "fixture-access-key",
  R2_SECRET_ACCESS_KEY: "fixture-secret-key",
  R2_BUCKET_NAME: "fixture-bucket",
};

test("upload transport is explicit and credentials never silently switch or downgrade it", () => {
  assert.equal(usesDirectR2({ ENVIRONMENT: "development" }), false);
  assert.equal(usesDirectR2({ ENVIRONMENT: "development", ...credentials }), false);
  assert.equal(usesDirectR2({ ENVIRONMENT: "production", UPLOAD_MODE: "proxy", ...credentials }), false);
  assert.equal(usesDirectR2({ ENVIRONMENT: "production", UPLOAD_MODE: "direct", ...credentials }), true);
  assert.throws(
    () => usesDirectR2({ ENVIRONMENT: "production", ...credentials }),
    (error) => error.status === 503,
  );
  assert.throws(
    () => usesDirectR2({ ENVIRONMENT: "development", UPLOAD_MODE: "automatic" }),
    (error) => error.status === 503,
  );
  for (const name of Object.keys(credentials)) {
    const env = { ENVIRONMENT: "production", UPLOAD_MODE: "direct", ...credentials };
    delete env[name];
    assert.equal(uploadModeConfiguration(env).ready, false);
    assert.throws(
      () => usesDirectR2(env),
      (error) => error.status === 503,
    );
  }
});

test("existing direct tasks can still sign parts after new uploads switch to proxy", async () => {
  const env = { ENVIRONMENT: "production", UPLOAD_MODE: "proxy", ...credentials };
  const url = new URL(await presignDirectPart(env, "retained/photo.jpg", "retained-upload", 2));
  assert.equal(url.searchParams.get("uploadId"), "retained-upload");
  assert.equal(url.searchParams.get("partNumber"), "2");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
});

test("misconfigured upload mode fails before file tasks or capacity reservations are created", async () => {
  const db = createDatabase();
  db.exec("INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin','fixture','admin')");
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    ENVIRONMENT: "production",
    SESSION_SECRET: "mode-test-session-secret",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  const cookie =
    "blackbox_csrf=mode-csrf; blackbox_session=" +
    (await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  for (const mode of [undefined, "direct"]) {
    env.UPLOAD_MODE = mode;
    const response = await worker.fetch(
      new Request("https://blackbox.test/api/uploads", {
        method: "POST",
        headers: { Cookie: cookie, "x-csrf-token": "mode-csrf", "content-type": "application/json" },
        body: JSON.stringify({
          title: "剧本",
          resType: "script",
          originalName: "script.pdf",
          contentType: "application/pdf",
          sizeBytes: 16,
        }),
      }),
      env,
      context(),
    );
    assert.equal(response.status, 503, await response.clone().text());
    assert.equal(db.prepare("SELECT COUNT(*) n FROM upload_task").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM storage_reservation").get().n, 0);
    assert.equal(env.FILES.multiparts.size, 0);
  }
  db.close();
});
