import { UploadError } from "./upload-policy";

export const THREE_D_MODEL_LIMIT = 512 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
const scalarBytes: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};
const floatTypes = new Set(["float", "float32", "double", "float64"]);
const uint32Types = new Set(["uint", "uint32"]);
const ordinary = [
  "x",
  "y",
  "z",
  "opacity",
  "scale_0",
  "scale_1",
  "scale_2",
  "rot_0",
  "rot_1",
  "rot_2",
  "rot_3",
  "f_dc_0",
  "f_dc_1",
  "f_dc_2",
];
const packed = ["packed_position", "packed_rotation", "packed_scale", "packed_color"];
const chunkBounds = [
  "min_x",
  "min_y",
  "min_z",
  "max_x",
  "max_y",
  "max_z",
  "min_scale_x",
  "min_scale_y",
  "min_scale_z",
  "max_scale_x",
  "max_scale_y",
  "max_scale_z",
];
type Element = { rows: number; bytesPerRow: number; properties: Map<string, string> };

function invalidPly(): never {
  throw new UploadError("模型必须是完整的二进制高斯 PLY，支持 Nerfstudio 和 SuperSplat 压缩导出。");
}

export async function validateGaussianPly(bucket: R2Bucket, key: string, size: number): Promise<void> {
  const object = await bucket.get(key, { range: { offset: 0, length: Math.min(MAX_HEADER_BYTES, size) } });
  if (!object) throw new UploadError("模型尚未完整保存，请稍后重试。", 502);
  // Latin-1 decoding preserves one character per byte for locating the binary payload.
  const header = new TextDecoder("latin1").decode(await object.arrayBuffer());
  const boundary = /^end_header\r?\n/m.exec(header);
  if (!boundary) invalidPly();
  const lines = header.slice(0, boundary.index).trimEnd().split(/\r?\n/);
  if (lines.shift() !== "ply" || lines.shift() !== "format binary_little_endian 1.0") invalidPly();
  const elements = new Map<string, Element>();
  let current: Element | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^(?:comment|obj_info)(?:\s|$)/.test(line)) continue;
    const [kind, name, value, extra] = line.split(/\s+/);
    if (extra || !value) invalidPly();
    if (kind === "element") {
      const rows = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(rows) || rows < 0 || elements.has(name)) invalidPly();
      current = { rows, bytesPerRow: 0, properties: new Map() };
      elements.set(name, current);
    } else if (kind === "property") {
      if (!current || !Object.hasOwn(scalarBytes, name) || current.properties.has(value)) invalidPly();
      current.bytesPerRow += scalarBytes[name];
      current.properties.set(value, name);
    } else {
      invalidPly();
    }
  }
  const vertex = elements.get("vertex");
  if (!vertex?.rows) invalidPly();
  const hasProps = (element: Element, names: string[], types: Set<string>) =>
    names.every((name) => types.has(element.properties.get(name) ?? ""));
  const chunk = elements.get("chunk");
  const standard = hasProps(vertex, ordinary, floatTypes);
  const compressed = Boolean(
    chunk &&
    chunk.rows === Math.ceil(vertex.rows / 256) &&
    hasProps(chunk, chunkBounds, floatTypes) &&
    hasProps(vertex, packed, uint32Types),
  );
  if (!standard && !compressed) invalidPly();
  let payload = 0;
  for (const { rows, bytesPerRow } of elements.values()) {
    if (rows && !bytesPerRow) invalidPly();
    payload += rows * bytesPerRow;
  }
  if (!Number.isSafeInteger(payload) || boundary.index + boundary[0].length + payload !== size) invalidPly();
}

export function validateThreeDCover(bytes: Uint8Array): void {
  const invalid = () => new UploadError("封面必须是最长边不超过 1600 像素的有效 JPEG。");
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw invalid();
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  let dimensions = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length - 2) throw invalid();
    if (sof.has(marker)) {
      if (dimensions || length < 8) throw invalid();
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (!width || !height || Math.max(width, height) > 1600) throw invalid();
      dimensions = true;
    }
    if (marker === 0xda && dimensions) return;
    if (marker === 0xda || marker === 0xd8 || marker === 0xd9 || marker < 0xc0) throw invalid();
    offset += length;
  }
  throw invalid();
}
