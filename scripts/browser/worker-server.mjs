import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readFileSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { context } from "../backend/harness.mjs";

export function staticAssets(root = resolve("public")) {
  const mime = {
    ".js": "text/javascript",
    ".css": "text/css",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
  };
  return {
    async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const file = resolve(root, "." + decodeURIComponent(pathname));
      if (!file.startsWith(root + sep)) return new Response("Not found", { status: 404 });
      try {
        return new Response(readFileSync(file), {
          headers: {
            "Content-Type": mime[extname(file)] || "application/octet-stream",
            "Cache-Control": /^\/(assets|fonts)\//.test(pathname) ? "public, max-age=31536000, immutable" : "no-cache",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };
}

// Local synthetic Worker only. Stream responses and preserve multiple Set-Cookie headers.
export async function serveWorker({ worker, env, port = 0, beforeRequest, allowWrites = false }) {
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      const intercepted = await beforeRequest?.(url, incoming);
      const ctx = context();
      const request = () =>
        new Request(url, {
          method: incoming.method,
          headers: incoming.headers,
          ...(!["GET", "HEAD"].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: "half" } : {}),
        });
      const response =
        intercepted ||
        (!allowWrites && !["GET", "HEAD"].includes(incoming.method)
          ? new Response(null, { status: 405 })
          : await worker.fetch(request(), env, ctx));
      const headers = Object.fromEntries(response.headers);
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers["set-cookie"] = cookies;
      outgoing.writeHead(response.status, headers);
      if (incoming.method !== "HEAD" && response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
      else outgoing.end();
      await ctx.flush();
    } catch (error) {
      if (outgoing.headersSent) outgoing.destroy(error);
      else outgoing.writeHead(500).end("Synthetic fixture error");
      console.error(error.message);
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  };
}
