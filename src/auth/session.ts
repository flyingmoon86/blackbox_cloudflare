export type SessionPayload = { uid: number; version: number; exp: number };

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return new Uint8Array(decoded.buffer as ArrayBuffer);
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function createSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64Url(await hmac(secret, body))}`;
}

export async function readSession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, decodeBase64Url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(body))) as Partial<SessionPayload>;
    if (!Number.isInteger(payload.uid) || !Number.isInteger(payload.version) || !Number.isInteger(payload.exp)) return null;
    if ((payload.exp as number) <= Math.floor(Date.now() / 1000)) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function newCsrfToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}
