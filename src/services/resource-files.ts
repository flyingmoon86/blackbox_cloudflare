import type { Bindings, UserSession } from "../types";

export function canViewResource(
  resource: { status: string; uploader_id: number | null },
  user: UserSession | null,
): boolean {
  return resource.status === "approved" || Boolean(user && (resource.uploader_id === user.id || user.role === "admin"));
}

const safeTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};
function contentType(filename: string): string {
  return safeTypes[filename.split(".").pop()?.toLowerCase() || ""] || "application/octet-stream";
}
function parseRange(value: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) return null;
    return { offset: Math.max(0, size - suffix), length: Math.min(suffix, size) };
  }
  const start = Number(match[1]),
    end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
  return { offset: start, length: Math.min(size - 1, end) - start + 1 };
}

/** Call only after resolving the current database reference and checking permission.
 * Stored MIME metadata is untrusted; executable formats are always attachments.
 */
export async function serveResourceFile(
  request: Request,
  bucket: Bindings["FILES"],
  options: {
    key: string;
    filename?: string;
    download?: boolean;
    publicImage?: boolean;
  },
): Promise<Response> {
  const name = options.filename || options.key;
  const type = contentType(name);
  if (options.publicImage && !type.startsWith("image/")) return new Response("图片格式不受支持。", { status: 404 });
  const metadata = await bucket.head(options.key);
  if (!metadata) return new Response("文件不存在或尚未迁入存储。", { status: 404 });
  const headers = new Headers({
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
    ETag: metadata.httpEtag,
    "Last-Modified": metadata.uploaded.toUTCString(),
    // Revalidate authorization/reference even if the browser has cached the bytes.
    "Cache-Control": options.publicImage ? "public, no-cache" : "private, no-cache",
    "Content-Disposition":
      (options.download || type === "application/octet-stream" ? "attachment" : "inline") +
      "; filename*=UTF-8''" +
      encodeURIComponent(new TextDecoder().decode(new TextEncoder().encode(name))),
  });
  const etags = request.headers.get("if-none-match");
  if (
    etags &&
    etags.split(",").some((tag) => tag.trim() === "*" || tag.trim().replace(/^W\//, "") === metadata.httpEtag)
  )
    return new Response(null, { status: 304, headers });
  const modified = request.headers.get("if-modified-since");
  if (!etags && modified && Math.floor(metadata.uploaded.getTime() / 1000) <= Math.floor(Date.parse(modified) / 1000))
    return new Response(null, { status: 304, headers });
  let range: { offset: number; length: number } | undefined;
  const requestedRange = request.method === "HEAD" ? null : request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const rangeMatches =
    !ifRange ||
    ifRange === metadata.httpEtag ||
    (!ifRange.startsWith('"') &&
      !ifRange.startsWith("W/") &&
      Math.floor(metadata.uploaded.getTime() / 1000) <= Math.floor(Date.parse(ifRange) / 1000));
  if (requestedRange && rangeMatches) {
    const parsed = parseRange(requestedRange, metadata.size);
    if (!parsed) {
      headers.set("Content-Range", "bytes */" + metadata.size);
      return new Response(null, { status: 416, headers });
    }
    range = parsed;
    headers.set(
      "Content-Range",
      "bytes " + range.offset + "-" + (range.offset + range.length - 1) + "/" + metadata.size,
    );
  }
  headers.set("Content-Length", String(range?.length ?? metadata.size));
  if (request.method === "HEAD") return new Response(null, { headers });
  const object = await bucket.get(options.key, { onlyIf: { etagMatches: metadata.etag }, ...(range ? { range } : {}) });
  if (!object) return new Response("文件不存在。", { status: 404 });
  if (!("body" in object)) return new Response("文件正在更新，请刷新后重试。", { status: 412 });
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
