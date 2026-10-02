import { escapeHtml as e } from "../views";
import { assetUrl } from "./assets";
import { stageSources } from "./stage-art";
import { stageScenes, stageSettings } from "../services/stage-visuals";

export function stageEditor(texts: string) {
  const settings = stageSettings(texts);
  const labels = {
    home: "首页 · 黑匣子剧场",
    productions: "作品与资料 · 迎风协作",
    members: "队员与剧团 · 举起书本",
    thanks: "鸣谢 · 指向远方",
  };
  const directions = {
    home: "使用原图黄色灯光",
    productions: "右上向左下 · 暖白",
    members: "顶部宽幅柔光 · 淡蓝",
    thanks: "左上向右下 · 冷白",
  };
  const shortLabels = { home: "首页", productions: "作品与资料", members: "队员与剧团", thanks: "鸣谢" };
  return `<link rel="stylesheet" href="${assetUrl("/stage-editor.css")}"><script src="${assetUrl("/stage-editor.js")}" defer></script><p>底图与透明光层作为一组管理。开关状态四页同步；下方预览独立，不改变访客开关状态。</p><nav class="stage-editor-nav" data-stage-nav aria-label="选择背景页面">${stageScenes.map((scene) => `<a id="stage-tab-${scene}" href="#stage-${scene}" aria-controls="stage-${scene}">${shortLabels[scene]}</a>`).join("")}</nav>${stageScenes
    .map((scene) => {
      const config = settings[scene],
        current = stageSources(scene, texts),
        builtin = stageSources(scene, "{}");
      const range = (field: string, label: string, value: number) =>
        `<label>${label} <output>${value}%</output><input type="range" min="0" max="100" step="1" name="stage_${scene}_${field}" value="${value}" data-stage-field="${field}"></label>`;
      return `<fieldset id="stage-${scene}" class="stage-editor" data-stage-editor="${scene}" data-current-base="${e(current.unlit)}" data-current-light="${e(current.light)}" data-builtin-base="${e(builtin.unlit)}" data-builtin-light="${e(builtin.light)}"><legend>${labels[scene]}</legend><div class="stage-editor-controls"><label>成对素材<select name="stage_${scene}_pair" data-pair-mode><option value="current">保留当前素材${config.pair ? "（管理员上传）" : "（内置）"}</option><option value="builtin">恢复本页内置素材</option><option value="upload">上传新的底图与透明光层</option></select></label><div data-pair-upload hidden><p>两张图片尺寸须一致，非交错 8 位 PNG，每张 ≤8 MB，总尺寸 ≤800 万像素。透明光层须为 RGBA，透明区域不应填成黑色。</p><label>关灯底图<input type="file" accept="image/png" name="stage_${scene}_base" data-pair-base disabled></label><label>透明光层<input type="file" accept="image/png" name="stage_${scene}_light" data-pair-light disabled></label></div>${range("intensity", "开灯强度", config.intensity)}${range("shade", "阅读遮罩", config.shade)}${scene === "home" ? `<p>${directions[scene]}</p>` : `<label>方向光<select name="stage_${scene}_direction" data-direction-mode><option value="preset"${config.direction !== false ? " selected" : ""}>${directions[scene]}</option><option value="ambient"${config.direction === false ? " selected" : ""}>仅环境明暗（没有明确主体时）</option></select></label>`}<details><summary>桌面与手机裁切位置</summary><p>百分比控制图片对齐位置，两张图层始终同步；手机优先保留主体和关键动作。</p>${range("desktopX", "桌面水平", config.desktopX)}${range("desktopY", "桌面垂直", config.desktopY)}${range("mobileX", "手机水平", config.mobileX)}${range("mobileY", "手机垂直", config.mobileY)}</details></div><div class="stage-preview-tools"><label>预览尺寸<select data-preview-size><option value="desktop">桌面 1280 × 800</option><option value="mobile">手机 390 × 844</option></select></label><button type="button" data-preview-light aria-pressed="false">预览开灯</button></div><p class="stage-upload-status" role="status"></p><div class="stage-preview-shell"><iframe title="${labels[scene]}实际页面预览" loading="lazy" src="${scene === "home" ? "/" : "/" + scene}?stage-preview=1" sandbox="allow-scripts allow-same-origin"></iframe></div></fieldset>`;
    })
    .join("")}`;
}
