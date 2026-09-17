import type { Bindings } from "../types";

/**
 * Thin wrapper over the Cloudflare Cache API (`caches.default`).
 *
 * Everything degrades to a cache miss when the Cache API is unavailable, so the
 * Node test harness and local tooling keep running without a cache polyfill.
 * Cache keys live on the configured public origin and never include request
 * headers, so only responses that are identical for every visitor may use them.
 */
const PREFIX = "/__edge-cache";

// Structural view of `caches.default`; the DOM lib and workers-types disagree
// about the global CacheStorage shape, so avoid depending on either.
type EdgeCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete(request: Request): Promise<boolean>;
};

function edgeCache(): EdgeCache | null {
  const storage = (globalThis as { caches?: { default?: EdgeCache } }).caches;
  return storage?.default ?? null;
}

export function cacheOrigin(env: Bindings, request: Request): string {
  return env.PUBLIC_ORIGIN || new URL(request.url).origin;
}

function cacheRequest(origin: string, parts: readonly string[]): Request {
  const url = new URL(origin);
  url.pathname = PREFIX + "/" + parts.map((part) => encodeURIComponent(part)).join("/");
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

/** Cache TTL follows `s-maxage`; the browser directive stays independent. */
function cacheControl(edgeSeconds: number, browser: number | "no-cache"): string {
  return `public, ${browser === "no-cache" ? "no-cache" : `max-age=${browser}`}, s-maxage=${edgeSeconds}`;
}

export async function readCachedResponse(origin: string, parts: readonly string[]): Promise<Response | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    return (await cache.match(cacheRequest(origin, parts))) ?? null;
  } catch {
    return null;
  }
}

export async function writeCachedResponse(
  origin: string,
  parts: readonly string[],
  response: Response,
  edgeSeconds: number,
  browser: number | "no-cache" = 0,
): Promise<void> {
  const cache = edgeCache();
  if (!cache || response.status !== 200 || response.body === null) return;
  try {
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", cacheControl(edgeSeconds, browser));
    await cache.put(cacheRequest(origin, parts), new Response(response.clone().body, { status: 200, headers }));
  } catch {
    // Cache writes are best effort; serving the live response stays correct.
  }
}

export async function readCachedJson<T>(origin: string, parts: readonly string[]): Promise<T | null> {
  const response = await readCachedResponse(origin, parts);
  if (!response) return null;
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function writeCachedJson(
  origin: string,
  parts: readonly string[],
  value: unknown,
  edgeSeconds: number,
): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(
      cacheRequest(origin, parts),
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `max-age=${edgeSeconds}` },
      }),
    );
  } catch {
    // Best effort only.
  }
}

export async function invalidateCached(origin: string, parts: readonly string[]): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.delete(cacheRequest(origin, parts));
  } catch {
    // A failed invalidation falls back to the TTL.
  }
}
