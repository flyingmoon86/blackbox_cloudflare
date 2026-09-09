import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const DEFAULT_SCRYPT = { n: 32768, r: 8, p: 1, length: 64 } as const;

type ScryptParameters = { n: number; r: number; p: number };

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2)
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseWerkzeugScrypt(value: string): { params: ScryptParameters; salt: string; expected: Uint8Array } | null {
  const [method, salt, expectedHex, extra] = value.split("$");
  if (
    extra !== undefined ||
    !method ||
    !salt ||
    !expectedHex ||
    expectedHex.length % 2 !== 0 ||
    !/^[0-9a-f]+$/i.test(expectedHex)
  )
    return null;
  const [algorithm, nText, rText, pText, methodExtra] = method.split(":");
  if (methodExtra !== undefined || algorithm !== "scrypt") return null;
  const params = { n: Number(nText), r: Number(rText), p: Number(pText) };
  if (!Number.isInteger(params.n) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return null;
  if (params.n < 2 || params.n > 131072 || params.r < 1 || params.r > 32 || params.p < 1 || params.p > 16) return null;
  const expected = fromHex(expectedHex);
  return expected.length >= 32 && expected.length <= 128 ? { params, salt, expected } : null;
}

export function verifyPassword(stored: string, password: string): boolean {
  const parsed = parseWerkzeugScrypt(stored);
  if (!parsed) return false;
  try {
    const actual = scryptSync(password, parsed.salt, parsed.expected.length, {
      N: parsed.params.n,
      r: parsed.params.r,
      p: parsed.params.p,
      maxmem: 128 * 1024 * 1024,
    });
    return timingSafeEqual(actual, parsed.expected);
  } catch {
    return false;
  }
}

export function hashPassword(password: string): string {
  const salt = toHex(randomBytes(16));
  const digest = scryptSync(password, salt, DEFAULT_SCRYPT.length, {
    N: DEFAULT_SCRYPT.n,
    r: DEFAULT_SCRYPT.r,
    p: DEFAULT_SCRYPT.p,
    maxmem: 128 * 1024 * 1024,
  });
  return `scrypt:${DEFAULT_SCRYPT.n}:${DEFAULT_SCRYPT.r}:${DEFAULT_SCRYPT.p}$${salt}$${toHex(digest)}`;
}
