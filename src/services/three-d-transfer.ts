import type { Bindings } from "../types";
import { serveResourceFile } from "./resource-files";

/** Optional, offline-prepared lossless transfer; never compress on a visitor's request.
 * Call only AFTER scene authorization. The source ETag prevents stale derivatives.
 */
export async function serveThreeDModel(request: Request, bucket: Bindings["FILES"], key: string, filename: string) {
  if (new URL(request.url).searchParams.get("transfer") === "gzip" && !request.headers.has("range")) {
    const source = await bucket.head(key);
    if (source && /^[\w-]+$/.test(source.etag)) {
      const compressedKey = key + ".transfer-" + source.etag + ".gz";
      const compressed = await bucket.head(compressedKey);
      if (compressed) {
        const response = await serveResourceFile(request, bucket, { key: compressedKey, filename: filename + ".gz" });
        const headers = new Headers(response.headers);
        headers.set("X-Model-Compression", "gzip");
        headers.set("X-Model-Size", String(source.size));
        return new Response(response.body, { status: response.status, headers });
      }
    }
  }
  return serveResourceFile(request, bucket, { key, filename });
}
