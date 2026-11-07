import type { ThreeDScene } from "../services/three-d";
import { escapeHtml, message } from "./html";
import { layout } from "./layout";

const base = "/admin/three-d";
const statuses = { draft: "草稿", published: "已发布", archived: "已下架" };
const editPath = (scene: ThreeDScene) => base + "/" + escapeHtml(encodeURIComponent(scene.id));
const csrfInput = (csrf: string) => `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}">`;

export function threeDAdminListPage(scenes: ThreeDScene[], flash = ""): string {
  const cards = scenes
    .map((scene) => {
      const pending = scene.pending_model_key || scene.pending_cover_key;
      return `<article class="card">
        <p class="eyebrow">${statuses[scene.status]} · 排序 ${escapeHtml(scene.sort_order)}${pending ? " · 有待发布文件" : ""}</p>
        <h2><a href="${editPath(scene)}">${escapeHtml(scene.title)}</a></h2>
        ${scene.description ? `<p>${escapeHtml(scene.description)}</p>` : ""}
        <a href="${editPath(scene)}">编辑场景</a>
      </article>`;
    })
    .join("");
  return layout(
    "三维档案管理",
    `<section class="page-heading">
      <h1>三维档案管理</h1>
      <p>新建场景、上传模型和封面，预览确认后发布。</p>
      ${message(flash, "notice")}
      <a class="button" href="${base}/new">新建场景</a>
    </section>
    <section class="review-grid" aria-label="场景列表">${cards || '<p class="card">还没有三维场景。</p>'}</section>`,
    true,
    true,
  );
}

type EditOptions = {
  scene?: ThreeDScene;
  productions: { id: number; title: string }[];
  editions: { id: number; production_id: number; name: string; year: number | null }[];
  csrf: string;
  error?: string;
  flash?: string;
};

export function threeDAdminEditPage({
  scene,
  productions,
  editions,
  csrf,
  error = "",
  flash = "",
}: EditOptions): string {
  const heading = scene ? "编辑三维场景" : "新建三维场景";
  const path = scene ? editPath(scene) : base;
  const token = csrfInput(csrf);
  const revision = scene ? `<input type="hidden" name="revision" value="${escapeHtml(scene.revision)}">` : "";
  const fields = `
    <form method="post" action="${path}" data-three-d-metadata>
      ${token}${revision}
      <label>场景标题<input name="title" maxlength="100" required value="${escapeHtml(scene?.title)}"></label>
      <label>简介<textarea name="description" maxlength="2000" rows="4">${escapeHtml(scene?.description)}</textarea></label>
      <label>排序<input type="number" name="sort_order" min="0" max="9999" step="1" required value="${escapeHtml(scene?.sort_order ?? 0)}"><span class="hint">数字越小越靠前。</span></label>
      <label>关联作品<select name="production_id">
        <option value="">独立场景</option>
        ${productions
          .map(
            (item) =>
              `<option value="${item.id}"${item.id === scene?.production_id ? " selected" : ""}>${escapeHtml(item.title)}</option>`,
          )
          .join("")}
      </select></label>
      <label>关联演出版本<select name="edition_id">
        <option value="">不指定演出版本</option>
        ${editions
          .map(
            (item) =>
              `<option value="${item.id}" data-production="${item.production_id}"${item.id === scene?.edition_id ? " selected" : ""}>${item.year ? `${escapeHtml(item.year)} · ` : ""}${escapeHtml(item.name)}</option>`,
          )
          .join("")}
      </select></label>
      <button type="submit">${scene ? "保存场景信息" : "保存草稿并继续"}</button>
    </form>`;
  const uploads = scene ? uploadCards(scene, csrf) : "";
  const publication = scene ? publicationCard(scene, token, revision) : "";
  return layout(
    heading,
    `<p class="back-links"><a href="${base}">← 返回三维档案管理</a></p>
    <section class="card auth wide">
      <h1>${heading}</h1>
      <p class="muted">${scene ? `当前状态 · ${statuses[scene.status]}` : "保存草稿后可以上传模型和封面。"}</p>
      ${message(error)}${message(flash, "notice")}
      ${fields}
    </section>
    ${uploads}
    ${publication}`,
    true,
    true,
  );
}

function uploadCards(scene: ThreeDScene, csrf: string): string {
  const readyName = (filename: string | null) => escapeHtml(filename || "已上传");
  const detail = (active: string | null, activeName: string | null, staged: string | null, stagedName: string | null) =>
    `<p class="muted">当前文件 · ${active ? readyName(activeName) : "未上传"}</p>
      ${staged ? `<p class="notice">待发布 · ${readyName(stagedName)}</p>` : ""}`;
  return `<section class="card auth wide form-sep" data-three-d-upload data-scene="${escapeHtml(scene.id)}" data-csrf="${escapeHtml(csrf)}">
    <h2>模型与封面</h2>
    <p>先保存场景信息，再上传。替换文件会暂存，可预览后发布。</p>
    <form data-three-d-model>
      <h3>三维模型</h3>
      ${detail(scene.model_key, scene.model_filename, scene.pending_model_key, scene.pending_model_filename)}
      <label>选择高斯 PLY<input type="file" name="model" accept=".ply" disabled required><span class="hint">支持压缩 PLY，最大 512 MiB。刷新后重新选择同一个文件即可续传。</span></label>
      <div class="upload-feedback">
        <progress id="three-d-progress" aria-label="模型上传进度" max="1" value="0"></progress>
        <output for="three-d-progress" data-three-d-percent>0%</output>
        <p role="status" aria-live="polite" data-three-d-model-status class="muted">尚未开始上传。</p>
      </div>
      <div class="wb-actions">
        <button type="submit" data-three-d-model-start disabled>上传模型</button>
        <button type="button" class="secondary" data-three-d-pause hidden>传完当前分片后暂停</button>
        <button type="button" class="secondary" data-three-d-cancel hidden>取消本次上传</button>
      </div>
    </form>
    <form class="form-sep" data-three-d-cover>
      <h3>封面</h3>
      ${detail(scene.cover_key, scene.cover_filename, scene.pending_cover_key, scene.pending_cover_filename)}
      <label>选择封面<input type="file" name="cover" accept="image/jpeg,image/png,image/webp" disabled required><span class="hint">可选 JPG、PNG 或 WebP，网页会转成适合展示的 JPEG。</span></label>
      <p role="status" aria-live="polite" data-three-d-cover-status class="muted"></p>
      <button type="submit" disabled>上传封面</button>
    </form>
    <noscript><p class="notice">启用 JavaScript 后可以上传并预览文件。</p></noscript>
  </section>`;
}

function publicationCard(scene: ThreeDScene, token: string, revision: string): string {
  const path = editPath(scene);
  const hasModel = Boolean(scene.model_key || scene.pending_model_key);
  const ready = hasModel && Boolean(scene.cover_key || scene.pending_cover_key);
  const pending = Boolean(scene.pending_model_key || scene.pending_cover_key);
  const published = scene.status === "published";
  return `<section class="card auth wide form-sep" data-three-d-publication>
    <h2>预览与发布</h2>
    <p>${ready ? "预览确认无误后，即可发布当前模型与封面。" : "上传模型和封面后可以发布。"}</p>
    ${hasModel ? `<p><a href="${path}/preview" target="_blank" rel="noopener">预览场景（新窗口）</a></p>` : ""}
    ${!published || pending ? `<form method="post" action="${path}/publish">${token}${revision}<button type="submit"${ready ? "" : " disabled"}>${published ? "发布文件更新" : "发布场景"}</button></form>` : ""}
    ${published ? `<form class="form-sep" method="post" action="${path}/archive" data-confirm="下架后，访客将无法打开这个场景。确定下架吗？">${token}${revision}<button type="submit" class="secondary">下架场景</button></form>` : ""}
  </section>`;
}
