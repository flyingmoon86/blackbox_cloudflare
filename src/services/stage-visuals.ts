import { unzlibSync } from "fflate";

export const stageScenes = ["home", "productions", "members", "thanks"] as const;
export type StageScene = (typeof stageScenes)[number];
export type StageVisual = {
  intensity: number;
  shade: number;
  desktopX: number;
  desktopY: number;
  mobileX: number;
  mobileY: number;
  direction?: boolean;
  pair?: { key: string; width: number; height: number };
};
export const stageDefaults: Record<StageScene, StageVisual> = {
  home: { intensity: 100, shade: 0, desktopX: 50, desktopY: 50, mobileX: 43, mobileY: 50 },
  productions: { intensity: 85, shade: 58, desktopX: 50, desktopY: 45, mobileX: 64, mobileY: 45 },
  members: { intensity: 85, shade: 58, desktopX: 50, desktopY: 45, mobileX: 50, mobileY: 35 },
  thanks: { intensity: 85, shade: 58, desktopX: 50, desktopY: 45, mobileX: 43, mobileY: 40 },
};
export const stageFields = ["intensity", "shade", "desktopX", "desktopY", "mobileX", "mobileY"] as const;
export function stageSettings(texts = "{}"): Record<StageScene, StageVisual> {
  let saved: any = {};
  try {
    saved = JSON.parse(JSON.parse(texts).stage_visuals || "{}");
  } catch {}
  return Object.fromEntries(
    stageScenes.map((scene) => {
      const value = { ...stageDefaults[scene] };
      value.direction = scene !== "home" && saved?.[scene]?.direction !== false;
      for (const field of stageFields) {
        const n = saved?.[scene]?.[field];
        if (typeof n === "number" && Number.isFinite(n)) value[field] = Math.min(100, Math.max(0, n));
      }
      const pair = saved?.[scene]?.pair;
      if (
        pair &&
        /^[a-f0-9-]{36}$/.test(pair.key) &&
        Number.isInteger(pair.width) &&
        Number.isInteger(pair.height) &&
        pair.width > 0 &&
        pair.height > 0 &&
        pair.width * pair.height <= 8_000_000
      )
        value.pair = pair;
      return [scene, value];
    }),
  ) as Record<StageScene, StageVisual>;
}

// Validate the actual PNG pixels, not its filename or MIME metadata. Light layers
// must contain both transparent and visible pixels; opaque black cannot be a mask.
export function inspectStagePng(bytes: Uint8Array, light = false) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 45 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(12) !== 0x49484452
  )
    throw Error("素材必须是 PNG 图片。");
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 8_000_000)
    throw Error("图片尺寸不能超过 800 万像素或单边 8192 像素。");
  if (bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[28] !== 0)
    throw Error("请使用非交错、8 位 RGB / RGBA PNG；光层必须是 RGBA。");
  if (light && bytes[25] !== 6) throw Error("光层必须保留 RGBA 透明通道。");
  const chunks: Uint8Array[] = [];
  let size = 0,
    ended = false;
  for (let pos = 8; pos + 12 <= bytes.length;) {
    const length = view.getUint32(pos),
      type = view.getUint32(pos + 4);
    if (pos + length + 12 > bytes.length) throw Error("PNG 文件不完整。");
    if (type === 0x49444154) {
      chunks.push(bytes.subarray(pos + 8, pos + 8 + length));
      size += length;
    }
    if (type === 0x49454e44) {
      ended = true;
      break;
    }
    pos += length + 12;
  }
  if (!ended || !size) throw Error("PNG 文件不完整。");
  const compressed = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, offset);
    offset += chunk.length;
  }
  const channels = bytes[25] === 6 ? 4 : 3,
    stride = width * channels;
  const raw = unzlibSync(compressed, { out: new Uint8Array((stride + 1) * height) });
  if (raw.length !== (stride + 1) * height) throw Error("PNG 像素数据不完整。");
  let prior = new Uint8Array(stride),
    transparent = false,
    visible = false;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw Error("PNG 像素格式无效。");
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0,
        b = prior[x],
        c = x >= channels ? prior[x - channels] : 0;
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      row[x] +=
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? Math.floor((a + b) / 2)
              : filter === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0;
      if (light && x % 4 === 3) {
        transparent ||= row[x] < 255;
        visible ||= row[x] > 0;
      }
    }
    prior = row;
  }
  if (light && (!transparent || !visible))
    throw Error("光层需要同时包含透明与可见像素，不能使用不透明黑底或全透明图片。");
  return { width, height };
}
