// One compressed/raw file at most, never decoded geometry or a running renderer.
const CACHE_LIMIT = 32 * 1024 * 1024;
let recent;

export function clearRecentModel() {
  recent = undefined;
}

// Invoked only by an explicit open/retry. Transfer and engine import can overlap.
export async function downloadModel(path, signal, report) {
  const url = new URL(path, location.href);
  if (typeof DecompressionStream === "function") url.searchParams.set("transfer", "gzip");
  const timing = { startedAt: performance.now() };
  let response;
  let cached;
  if (recent?.url === url.href) {
    const check = await fetch(url, { method: "HEAD", signal, cache: "no-store" });
    if (!check.ok) {
      recent = undefined;
      throw new Error("场景暂时不可用，请刷新档案页面。");
    }
    if (check.headers.get("etag") === recent.etag && !check.headers.get("cache-control")?.includes("no-store")) {
      cached = recent.blob;
      response = new Response(cached.stream(), { headers: check.headers });
      timing.cacheHit = true;
    }
  }
  if (!response) {
    recent = undefined;
    response = await fetch(url, { signal });
    timing.cacheHit = false;
  }
  timing.headersAt = performance.now();
  if (!response.ok || !response.body) throw new Error("暂时无法下载模型，请重试。");
  const compressed = response.headers.get("X-Model-Compression") === "gzip";
  const total = Number(response.headers.get("Content-Length")) || 0;
  const size = compressed ? Number(response.headers.get("X-Model-Size")) || 0 : total;
  const etag = response.headers.get("etag");
  let chunks =
    !cached &&
    url.pathname.startsWith("/3d/scenes/") &&
    etag &&
    total > 0 &&
    total <= CACHE_LIMIT &&
    !response.headers.get("cache-control")?.includes("no-store")
      ? []
      : null;
  let loaded = 0;
  let lastReport = 0;
  report({ stage: cached ? "prepare" : "download", loaded, total });
  const measured = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        signal.throwIfAborted();
        loaded += chunk.byteLength;
        if (chunks) {
          if (loaded > CACHE_LIMIT) chunks = null;
          else chunks.push(chunk);
        }
        const now = performance.now();
        if (!cached && now - lastReport > 100) {
          report({ stage: "download", loaded, total });
          lastReport = now;
        }
        controller.enqueue(chunk);
      },
      flush() {
        timing.downloadedAt = performance.now();
        timing.transferredBytes = cached ? 0 : loaded;
        if (chunks && loaded === total && !signal.aborted) {
          recent = { url: url.href, etag, blob: new Blob(chunks) };
          chunks = null;
        }
        report({ stage: "prepare", loaded, total });
      },
    }),
    { signal },
  );
  return {
    stream: compressed ? measured.pipeThrough(new DecompressionStream("gzip"), { signal }) : measured,
    size,
    timing,
    url: url.href,
  };
}
