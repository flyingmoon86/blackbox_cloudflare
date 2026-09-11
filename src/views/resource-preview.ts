import { escapeHtml } from "../views";

export type PreviewResource = {
  id: number;
  title: string;
  res_type: string;
  description: string;
  original_name: string;
  preview_filename: string;
};

function extension(name: string): string {
  const value = name.split(".").pop()?.toUpperCase() || "FILE";
  return value.length <= 6 ? value : "FILE";
}

function scriptArtwork(item: PreviewResource): string {
  return `<div class="resource-art script-art" aria-hidden="true"><span class="script-staples"></span><p>BLACK BOX · SCRIPT</p><strong>${escapeHtml(item.title)}</strong><span class="script-rule"></span><span class="script-rule short"></span><small>舞台剧本</small></div>`;
}

function audioArtwork(item: PreviewResource): string {
  return `<div class="resource-art audio-art" aria-hidden="true"><span class="record-disc"></span><div><p>BLACK BOX · AUDIO</p><strong>${escapeHtml(item.title)}</strong><span class="sound-wave">▂▅▃▇▄▆▂▅</span></div></div>`;
}

function fileArtwork(item: PreviewResource): string {
  return `<div class="resource-art file-art" aria-hidden="true"><span class="file-extension">${escapeHtml(extension(item.original_name))}</span><div><p>BLACK BOX · ARCHIVE</p><strong>${escapeHtml(item.title)}</strong></div></div>`;
}

export function resourceCardArtwork(item: PreviewResource): string {
  if (item.res_type === "photo")
    return `<img class="resource-card-media" src="/resources/${item.id}/preview" alt="${escapeHtml(item.title)}预览图" loading="lazy">`;
  if (item.res_type === "video")
    return item.preview_filename
      ? `<img class="resource-card-media" src="/resources/${item.id}/preview" alt="${escapeHtml(item.title)}视频画面" loading="lazy">`
      : fileArtwork(item);
  if (item.res_type === "script") return scriptArtwork(item);
  if (item.res_type === "audio") return audioArtwork(item);
  return fileArtwork(item);
}

export function resourceDetailPreview(item: PreviewResource, signedIn = true): string {
  if (!signedIn)
    return `<section class="resource-detail-preview">${resourceCardArtwork(item)}<p><a href="/login?next=/resources/${item.id}">登录后查看原文件与完整预览</a></p></section>`;
  const poster = item.preview_filename ? ` poster="/resources/${item.id}/preview"` : "";
  if (item.res_type === "photo")
    return `<figure class="resource-detail-preview"><img src="/resources/${item.id}/media" alt="${escapeHtml(item.title)}"></figure>`;
  if (item.res_type === "video")
    return `<section class="resource-detail-preview"><video controls playsinline preload="metadata"${poster} src="/resources/${item.id}/media">你的浏览器无法播放这个视频。</video></section>`;
  if (item.res_type === "audio")
    return `<section class="resource-detail-preview audio-preview">${audioArtwork(item)}<audio controls preload="metadata" src="/resources/${item.id}/media">你的浏览器无法播放这段音频。</audio></section>`;
  if (item.res_type === "script")
    return `<section class="resource-detail-preview document-preview">${scriptArtwork(item)}<div><h2>剧本预览</h2><p>点击后在浏览器中打开原文件；PDF 可以直接翻阅，Word 等格式可能由浏览器下载后打开。</p><a class="button" href="/resources/${item.id}/media" target="_blank" rel="noopener">打开剧本</a></div></section>`;
  return `<section class="resource-detail-preview document-preview">${fileArtwork(item)}<div><h2>文件预览</h2><p>这是 ${escapeHtml(extension(item.original_name))} 文件，点击下方下载按钮后使用对应软件查看。</p></div></section>`;
}
