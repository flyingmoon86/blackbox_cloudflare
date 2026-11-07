import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const out = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-06-three-d-loading");
mkdirSync(out, { recursive: true });
const results = [];
for (const id of ["03", "05"]) {
  const bytes = readFileSync(`artifacts/archive/releases/2026-11-06-three-d-archive/scene-${id}.compressed.ply`);
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  for (const kind of ["gzip", "br"]) {
    const start = performance.now();
    const encoded =
      kind === "gzip"
        ? gzipSync(bytes, { level: 9 })
        : brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } });
    const ms = performance.now() - start;
    const restored = kind === "gzip" ? gunzipSync(encoded) : brotliDecompressSync(encoded);
    const result = {
      id,
      kind,
      inputBytes: bytes.length,
      outputBytes: encoded.length,
      reduction: 1 - encoded.length / bytes.length,
      encodingMs: ms,
      identical: sha(bytes) === sha(restored),
    };
    writeFileSync(resolve(out, `scene-${id}.ply.${kind}`), encoded);
    results.push(result);
  }
}
writeFileSync(resolve(out, "compression.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
