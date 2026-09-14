import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./harness.mjs";
const { verifyTurnstile } = await loadModule("src/services/turnstile.ts");
test("Turnstile fails closed for missing config, invalid tokens, action/host mismatch and upstream failure", async () => {
  const c = {
    env: {
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SECRET: "test-only",
      TURNSTILE_HOSTNAMES: "blackbox.test",
      ENVIRONMENT: "production",
    },
    get: () => null,
  };
  const f = new FormData();
  await assert.rejects(verifyTurnstile(c, f, "signup"), (e) => e.status === 403);
  f.set("cf-turnstile-response", "test-token");
  const original = globalThis.fetch;
  try {
    for (const result of [
      { success: false },
      { success: true, action: "login", hostname: "blackbox.test" },
      { success: true, action: "signup", hostname: "evil.test" },
    ]) {
      globalThis.fetch = async () => Response.json(result);
      await assert.rejects(verifyTurnstile(c, f, "signup"), (e) => e.status === 403);
    }
    let used = false;
    globalThis.fetch = async () => {
      const success = !used;
      used = true;
      return Response.json({ success, action: "signup", hostname: "blackbox.test" });
    };
    await verifyTurnstile(c, f, "signup");
    await assert.rejects(verifyTurnstile(c, f, "signup"), (e) => e.status === 403);
    globalThis.fetch = async () => {
      throw Error("test outage");
    };
    await assert.rejects(verifyTurnstile(c, f, "signup"), (e) => e.status === 503);
    c.env.TURNSTILE_HOSTNAMES = "localhost";
    await assert.rejects(verifyTurnstile(c, f, "signup"), (e) => e.status === 503);
    c.env.TURNSTILE_ENABLED = "false";
    await verifyTurnstile(c, f, "signup");
  } finally {
    globalThis.fetch = original;
  }
});
