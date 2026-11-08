import type { ThreeDSceneView } from "../services/three-d";
import { escapeHtml } from "./html";
import { assetUrl } from "./assets";
import { layout } from "./layout";
import { archiveTabs } from "./shared";

export function threeDArchivePage(
  scenes: ThreeDSceneView[],
  signedIn: boolean,
  admin: boolean,
  preview?: { hasCover: boolean },
): string {
  const cards = scenes
    .map((scene) => {
      const id = encodeURIComponent(scene.id);
      const title = escapeHtml(scene.title);
      const path = preview ? "/admin/three-d/" + id + "/preview" : "/3d/scenes/" + id;
      const association = scene.production_title
        ? `<p class="splat-association"><a href="/productions/${scene.production_id}">${escapeHtml(scene.production_title)}</a>${scene.edition_name ? " · " + escapeHtml(scene.edition_name) : ""}</p>`
        : "";
      const cover =
        !preview || preview.hasCover
          ? `<img src="${path}/cover" width="780" height="520" alt="${title}的三维预览">`
          : `<div class="splat-cover-placeholder">尚未上传封面</div>`;
      return `
      <article class="splat-card">
        ${cover}
        <div class="splat-card-copy">
          <div class="splat-card-text">
            <h2>${title}</h2>
            ${association}
            ${scene.description ? `<p class="splat-description">${escapeHtml(scene.description)}</p>` : ""}
          </div>
          <button type="button" class="secondary" data-splat-open="${path}/model" data-splat-title="${title}">打开三维场景 <span aria-hidden="true">↗</span></button>
        </div>
      </article>`;
    })
    .join("");
  return layout(
    "三维档案",
    `${preview ? "" : archiveTabs("three-d")}<section class="splat-archive" data-splat-archive data-splat-engine="${assetUrl("/three-d-engine.js")}">
      <header class="${preview ? "splat-intro" : "page-heading splat-intro"}">
        ${preview ? '<a href="/admin/three-d">返回三维档案管理</a>' : '<p class="eyebrow">3D ARCHIVE</p>'}
        <h1>${preview ? "场景预览" : "三维档案"}</h1>
        <p>从自己的视角重访场景。选择一份档案，即可旋转、缩放，查看空间中的细节。</p>
      </header>
      <div class="splat-grid">${cards || "<p>暂无公开场景。</p>"}</div>
      <dialog class="splat-dialog" aria-labelledby="splat-title">
        <header class="splat-dialog-heading">
          <h2 id="splat-title"></h2>
          <form method="dialog"><button type="submit" class="secondary" autofocus>关闭 <span aria-hidden="true">×</span></button></form>
        </header>
        <div class="splat-stage">
          <div class="splat-viewport" data-splat-viewport aria-label="三维场景画布"></div>
          <div class="splat-loading" data-splat-loading hidden>
            <img data-splat-poster alt="" hidden>
            <div class="splat-loading-copy">
              <p data-splat-loading-title role="status">正在下载模型…</p>
              <progress data-splat-progress aria-label="模型下载进度" max="1"></progress>
              <p data-splat-loading-detail>准备好完整画面后即可自由旋转。</p>
              <button type="button" class="secondary" data-splat-retry hidden>重试</button>
            </div>
          </div>
          <p class="splat-status" data-splat-status role="status" hidden></p>
        </div>
        <div class="splat-tools" role="group" aria-label="视角操作">
<button type="button" class="secondary" data-splat-action="reset" disabled>复位</button><details class="splat-menu"><summary>视角</summary><div class="splat-menu-panel"><button type="button" class="secondary" data-splat-action="wide" disabled>全景</button><button type="button" class="secondary" data-splat-action="front" disabled>正面</button><button type="button" class="secondary" data-splat-action="top" disabled>俯视</button></div></details><button type="button" class="secondary" data-splat-action="fullscreen" hidden disabled>全屏</button><details class="splat-menu"><summary>更多</summary><div class="splat-menu-panel"><button type="button" class="secondary" data-splat-action="in" aria-label="放大" disabled>＋</button><button type="button" class="secondary" data-splat-action="out" aria-label="缩小" disabled>－</button><button type="button" class="secondary" data-splat-action="spin" aria-pressed="false" disabled>自动旋转</button><button type="button" class="secondary" data-splat-help aria-expanded="false" aria-controls="splat-help">帮助</button></div></details>
        </div>
        <p class="splat-hint" id="splat-help" hidden>拖动旋转 · 滚轮缩放 · 右键拖动平移 · R 复位<br>触屏：单指旋转，双指缩放或平移</p>
      </dialog>
      <noscript><p>请启用 JavaScript 后打开三维场景。</p></noscript>
    </section>`,
    signedIn,
    admin,
  );
}
