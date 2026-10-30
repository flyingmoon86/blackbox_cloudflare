// Only content-addressed PUBLIC static files. Never intercept documents,
// authenticated APIs, dynamic images, uploads, or private resource requests.
const CACHE = "blackbox-static-v1";
const eligible = (request) => {
  const url = new URL(request.url);
  return (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    !url.search &&
    !request.headers.has("Range") &&
    !request.headers.has("Authorization") &&
    (/^\/assets\/[^/]+\.[a-f0-9]{16}\.(?:js|css|webp|png|jpg|svg)$/.test(url.pathname) ||
      /^\/fonts\/[\w-]+-[a-f0-9]{16}\.woff2$/.test(url.pathname))
  );
};
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (!eligible(event.request)) return;
  event.respondWith(
    (async () => {
      let cache;
      try {
        cache = await caches.open(CACHE);
      } catch {
        return fetch(event.request);
      }
      let cached;
      try {
        cached = await cache.match(event.request);
      } catch {
        return fetch(event.request);
      }
      if (cached) return cached;
      const response = await fetch(event.request);
      if (
        response.ok &&
        !response.redirected &&
        !/no-store|private/.test(response.headers.get("Cache-Control") || "")
      ) {
        try {
          await cache.put(event.request, response.clone());
          const keys = await cache.keys();
          if (keys.length > 256) await Promise.all(keys.slice(0, keys.length - 256).map((key) => cache.delete(key)));
        } catch {
          /* Storage may be full or disabled. */
        }
      }
      return response;
    })(),
  );
});
