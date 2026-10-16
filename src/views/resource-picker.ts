import { escapeHtml } from "./html";
import type { ResourceChoice } from "../routes/productions";

const labels: Record<string, string> = { photo: "剧照", video: "视频", script: "剧本", audio: "音频", other: "其他" };
const symbols: Record<string, string> = { photo: "▧", video: "▷", script: "▤", audio: "♫", other: "▱" };

export function resourcePicker(resources: ResourceChoice[], productionId?: number, coverId?: number | null): string {
  const selected = resources.filter((resource) => resource.production_id === productionId).length;
  const ordered = [...resources].sort(
    (a, b) =>
      Number(b.production_id === productionId) - Number(a.production_id === productionId) ||
      Number(b.res_type === "photo") - Number(a.res_type === "photo") ||
      b.id - a.id,
  );
  const cards = ordered
    .map((resource) => {
      const label = labels[resource.res_type] || "其他";
      const title =
        !resource.title || (resource.title.length >= 28 && /^[A-Za-z0-9+/_=!.-]+$/.test(resource.title))
          ? `${label} #${resource.id}`
          : resource.title;
      const preview = resource.res_type === "photo" || Boolean(resource.preview_filename);
      const checked = resource.production_id === productionId;
      return `<article class="resource-picker-card" data-resource-card data-type="${escapeHtml(resource.res_type)}" data-status="${resource.status}" data-search="${escapeHtml(`${resource.id} ${resource.title} ${resource.original_name}`)}"><label class="resource-picker-choice"><span class="resource-picker-media"><span class="resource-picker-placeholder" aria-hidden="true"><b>${symbols[resource.res_type] || symbols.other}</b><span>${preview ? "图片预览" : label}</span></span>${preview ? `<img data-src="/resources/${resource.id}/preview" alt="" loading="lazy" decoding="async">` : ""}</span><span class="resource-picker-check"><input type="checkbox" name="resource_ids" value="${resource.id}"${checked ? " checked" : ""}><span data-choice-label>${checked ? "已选择" : "选择资料"}</span></span><span class="resource-picker-title" title="${escapeHtml(resource.title)}">${escapeHtml(title)}</span></label><div class="resource-picker-meta"><span>${label} · #${resource.id}</span><span class="resource-picker-status${resource.status === "pending" ? " is-pending" : ""}">${resource.status === "pending" ? "待审核" : "已入库"}</span></div><div class="resource-picker-card-footer"><span class="resource-picker-cover" data-cover-badge${resource.id === coverId ? "" : " hidden"}>当前封面</span><a href="/resources/${resource.id}" target="_blank" rel="noopener" aria-label="查看资料 #${resource.id} 的完整内容（新窗口）">查看资料 ↗</a></div></article>`;
    })
    .join("");
  return `<fieldset class="resource-picker" data-resource-picker><legend>关联 ARCHIVE 资料</legend><p class="resource-picker-intro">点击卡片勾选资料，保存作品后生效。可关联尚未归类的资料，以及本作品现有资料；待审核资料仍需审核。</p>${
    resources.length
      ? `<div class="resource-picker-tools" data-picker-tools hidden><div class="resource-picker-filters"><label class="resource-picker-search">搜索资料<input type="search" data-picker-search placeholder="搜索名称、文件名或编号" autocomplete="off"></label><label>资料类型<select data-picker-type><option value="">全部类型</option>${Object.entries(
          labels,
        )
          .map(([type, label]) => `<option value="${type}">${label}</option>`)
          .join(
            "",
          )}</select></label><label>审核状态<select data-picker-status><option value="">全部状态</option><option value="approved">已入库</option><option value="pending">待审核</option></select></label></div><div class="resource-picker-toolbar"><p class="resource-picker-count" data-picker-count role="status" aria-live="polite">已选 ${selected} 项 · 共 ${resources.length} 项</p><button type="button" class="secondary" data-picker-selected aria-pressed="false">只看已选</button></div><div class="resource-picker-page-actions"><span>本页操作</span><button type="button" class="secondary" data-picker-select-page>全选本页</button><button type="button" class="secondary" data-picker-clear-page>取消本页选择</button><button type="button" class="secondary" data-picker-reset>重置筛选</button></div><p class="resource-picker-warning" data-picker-cover-warning role="alert" hidden>当前封面未勾选。请重新选择这张资料，或在上方更换作品封面后保存。</p></div><div class="resource-picker-grid">${cards}</div><p class="resource-picker-empty" data-picker-empty hidden>没有符合条件的资料，试试其他关键词或重置筛选。</p><nav class="resource-picker-pagination" data-picker-pagination aria-label="关联资料分页" hidden><button type="button" class="secondary" data-picker-prev>上一页</button><span data-picker-page></span><button type="button" class="secondary" data-picker-next>下一页</button></nav><p class="resource-picker-note">翻页和筛选会保留勾选结果。取消关联只会将资料移出本作品，不会删除文件。</p>`
      : '<p class="resource-picker-empty">暂无可关联的资料。上传尚未归类的资料后，可回到这里选择。</p>'
  }</fieldset>`;
}
