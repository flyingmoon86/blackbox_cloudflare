// Read-only production verification plus local derivative preparation. No upload or DB writes.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";

const out = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-06-three-d-loading");
mkdirSync(out, { recursive: true });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = [];
for (const id of ["03", "05"]) {
  const path = resolve("artifacts/archive/releases/2026-11-06-three-d-archive", `scene-${id}.compressed.ply`);
  const raw = readFileSync(path);
  const started = performance.now();
  const response = await fetch(`https://npublackbox.online/3d/scenes/${id}/model`, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(`Public model ${id}: HTTP ${response.status}`);
  const headersMs = performance.now() - started;
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    hash.update(chunk);
  }
  if (hash.digest("hex") !== sha(raw)) throw new Error("Live source differs; do not publish an outdated derivative");
  const etag = response.headers.get("etag")?.replaceAll('"', "");
  if (!etag || !/^[\w-]+$/.test(etag)) throw new Error("Unsupported source ETag");
  const compressed = gzipSync(raw, { level: 9 });
  if (sha(gunzipSync(compressed)) !== sha(raw)) throw new Error("Lossless verification failed");
  const key = `three-d-archive/${id}/model.ply.transfer-${etag}.gz`;
  const file = resolve(out, `scene-${id}.ply.gzip`);
  writeFileSync(file, compressed);
  const entry = {
    id,
    key,
    file,
    sourceEtag: etag,
    sourceSha256: sha(raw),
    compressedSha256: sha(compressed),
    originalBytes: size,
    compressedBytes: compressed.length,
    headersMs,
    downloadMs: performance.now() - started,
  };
  manifest.push(entry);
  console.log(JSON.stringify(entry));
}
writeFileSync(resolve(out, "transfer-manifest.json"), JSON.stringify(manifest, null, 2));
// These exact public derivatives are retained with the legacy originals for rollback.
writeFileSync(
  resolve(out, "transfer-storage.sql"),
  manifest
    .map(
      ({ key, compressedBytes }) =>
        `INSERT INTO storage_object(object_key,size_bytes) VALUES('${key}',${compressedBytes}) ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes;`,
    )
    .join("\n") + "\n",
);
