import { assetUrl } from "./assets";
import { tryGetContext } from "hono/context-storage";
import type { AppEnv } from "../types";
import { stageSettings, type StageScene } from "../services/stage-visuals";
import { escapeHtml as e } from "./html";
export type { StageScene } from "../services/stage-visuals";

// Built-in pairs remain available when an administrator restores the original artwork.
const scenes = {
  home: { prefix: "theatre", width: 1672, height: 941 },
  productions: { prefix: "productions", width: 1668, height: 943 },
  members: { prefix: "members", width: 1672, height: 941 },
  thanks: { prefix: "thanks", width: 1672, height: 941 },
};
export function stageAttributes(scene: StageScene, texts?: string) {
  const c = tryGetContext<AppEnv>();
  const config = stageSettings(texts ?? c?.get("stageTexts"))[scene];
  return `data-theatre-scene="${scene}" data-stage-config="${e(JSON.stringify(config))}"${c?.get("user")?.role === "admin" && c.req.query("stage-preview") === "1" ? " data-stage-preview" : ""}`;
}
export function stageSources(scene: StageScene, texts?: string, mobile = false) {
  const config = stageSettings(texts ?? tryGetContext<AppEnv>()?.get("stageTexts"))[scene];
  return Object.fromEntries(
    ["unlit", "light"].map((layer) => [
      layer,
      config.pair
        ? `/site/stage-image/${scene}/${layer}?v=${config.pair.key}`
        : assetUrl(`/images/${scenes[scene].prefix}-${layer}${mobile ? "-mobile" : ""}.webp`),
    ]),
  ) as Record<"unlit" | "light", string>;
}
export function stageArt(scene: StageScene, texts?: string) {
  const c = tryGetContext<AppEnv>();
  const config = stageSettings(texts ?? c?.get("stageTexts"))[scene];
  const { width, height } = config.pair || scenes[scene];
  const sources = stageSources(scene, texts);
  // Mobile encodings keep the full image dimensions: portrait cover crops need
  // the image height, and both layers must share the same coordinate system.
  // The editor replaces img.src directly, so its preview uses the original pair.
  const responsive = !config.pair && !(c?.get("user")?.role === "admin" && c.req.query("stage-preview") === "1");
  const mobileSources = responsive ? stageSources(scene, texts, true) : null;
  const image = (layer: "unlit" | "light") => {
    const img = `<img data-theatre-${layer === "unlit" ? "base" : "light"} src="${sources[layer]}" width="${width}" height="${height}" alt=""${layer === "unlit" ? ' fetchpriority="high"' : ""}>`;
    return mobileSources
      ? `<picture><source media="(max-width:900px)" srcset="${mobileSources[layer]}">${img}</picture>`
      : img;
  };
  const lamp = assetUrl("/images/stage-lamp.png");
  const icon = `<svg class="stage-lamp-icon" viewBox="230 175 850 980" aria-hidden="true"><defs><filter id="lamp-housing-${scene}" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -4 0 0 0 3"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs><image href="${lamp}" width="1280" height="1280" filter="url(#lamp-housing-${scene})"/><image class="stage-lamp-lit" href="${lamp}" width="1280" height="1280"/></svg>`;
  // SVG uses the exact image coordinate system and the same cover crop. Beams
  // remain behind all text and cards, even when the viewport changes shape.
  const paths: Partial<Record<StageScene, string>> = {
    productions:
      '<path d="M830 -180 L1510 -140 L1070 940 Q450 1090 -260 840 Z" fill="#ffdfaa" opacity=".5"/><path d="M1280 -180 L1830 -70 L1850 920 Q1250 1060 650 930 Z" fill="#fff0cc" opacity=".38"/>',
    members: '<path d="M470 -150 Q840 -260 1200 -150 L1450 830 Q840 1020 210 830 Z" fill="#cce7f4"/>',
    thanks: '<path d="M130 -100 L200 -100 L1390 900 Q990 1030 720 930 Z" fill="#dceafa"/>',
  };
  const beam = paths[scene]
    ? `<svg class="stage-direction" viewBox="0 0 ${scenes[scene].width} ${scenes[scene].height}" preserveAspectRatio="none"><defs><filter id="beam-soft-${scene}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${scene === "productions" ? 75 : 15}"/></filter><linearGradient id="beam-fade-${scene}" x2="0" y2="1"><stop stop-color="white" stop-opacity=".9"/><stop offset=".45" stop-color="white" stop-opacity=".55"/><stop offset="1" stop-color="white" stop-opacity="0"/></linearGradient><mask id="beam-mask-${scene}"><rect width="100%" height="100%" fill="url(#beam-fade-${scene})"/></mask></defs><g filter="url(#beam-soft-${scene})" mask="url(#beam-mask-${scene})">${paths[scene]}</g></svg>`
    : "";
  return `<div class="theatre-art" aria-hidden="true"><div class="stage-image-plane">${image("unlit")}${image("light")}${beam}</div></div><button class="theatre-light-switch" type="button" aria-label="舞台灯光（四页同步）" aria-pressed="false" title="开灯（四页同步）" disabled>${icon}</button><span class="theatre-light-hint" id="stage-light-hint" hidden><span><strong>点击开灯</strong><small>让舞台亮起来</small></span><svg viewBox="0 0 32 20" width="32" height="20" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><path d="M2 14Q13 18 28 7M20 5l9 1-2 9"/></svg></span><span class="theatre-light-status" role="status"></span>`;
}
export function stageAssets() {
  return `<link rel="stylesheet" href="${assetUrl("/home-light.css")}"><script src="${assetUrl("/home-light.js")}" defer></script>`;
}
