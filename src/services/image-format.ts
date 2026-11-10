export type ImageFormat = "jpeg" | "png" | "webp" | "avif";

// Signature recognition only, not a full decoder. Callers own size, MIME and
// allowed-format policy. A range read can supply just the beginning of a file.
export function imageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return "png";
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WEBP") return "webp";
  if (bytes.length >= 16 && tag(4) === "ftyp") {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    // The version field is not a brand; brands must be aligned inside ftyp.
    if (length < 16 || length % 4 !== 0) return null;
    const avifBrand = (at: number) => ["avif", "avis"].includes(tag(at));
    if (avifBrand(8)) return "avif";
    for (let at = 16; at + 4 <= Math.min(length, bytes.length); at += 4) if (avifBrand(at)) return "avif";
  }
  return null;
}

export function matchesImageMime(bytes: Uint8Array, mime: string): boolean {
  const format = imageFormat(bytes);
  return format !== null && mime === `image/${format}`;
}
