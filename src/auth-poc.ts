import { scryptSync, timingSafeEqual } from "node:crypto";

const TEST_HASH = "scrypt:32768:8:1$phase0salt$a890e2f1dd05a29e1bbb5cf3eb2aa3b7e7d0b6dc516743896f6412565a663b628ba3c727d8c746c5fb2075a2f5230e3d5e9160d5782ab2b0277aa9cac6650cb5";

function checkWerkzeugScrypt(stored: string, password: string): boolean {
  const [method, salt, expectedHex] = stored.split("$");
  const [, nText, rText, pText] = method.split(":");
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length, {
    N: Number(nText),
    r: Number(rText),
    p: Number(pText),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/poc/password") {
      return new Response("Not Found", { status: 404 });
    }
    const started = performance.now();
    const compatible = checkWerkzeugScrypt(TEST_HASH, "phase0-test-password");
    return Response.json({
      ok: compatible,
      algorithm: "scrypt:32768:8:1",
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      uses_test_data: true,
    });
  },
};
