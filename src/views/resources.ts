import type { ResourceRow } from "../routes/resources";
import type { UserSession } from "../types";
import { escapeHtml, layout } from "../views";
import { resourceCardArtwork, resourceDetailPreview } from "./resource-preview";
const labels: Record<string, string> = { video: "视频", script: "剧本", photo: "剧照", audio: "音频", other: "其他" };
const statuses: Record<string, string> = { approved: "已入库", pending: "等待审核", rejected: "已驳回" };
function archiveTabs(active: "productions" | "resources"): string {
  return `<nav class="section-tabs" aria-label="作品与资料"><a href="/productions"${active === "productions" ? ' class="active" aria-current="page"' : ""}>作品档案</a><a href="/resources"${active === "resources" ? ' class="active" aria-current="page"' : ""}>资料库</a></nav>`;
}
export function resourceListPage(
  rows: ResourceRow[],
  user: UserSession | null,
  _csrf: string,
  mine = false,
  query = "",
): string {
  const card = (r: ResourceRow) =>
    `<article class="resource-card type-${escapeHtml(r.res_type)}"><a class="resource-card-link" href="/resources/${r.id}">${resourceCardArtwork(r)}<span class="resource-card-shade"></span><span class="resource-card-copy"><span class="eyebrow">${escapeHtml(labels[r.res_type] || r.res_type)} · ${escapeHtml(statuses[r.status] || r.status)}</span><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.description || r.original_name || "点击查看资料")}</span></span></a>${mine && r.admin_note ? `<p class="alert">审核说明：${escapeHtml(r.admin_note)}</p>` : ""}</article>`;
  const flatCards = rows.length
    ? rows
        .map(
          (r) => `<div><p class="muted">所属作品：${escapeHtml(r.production_title || "其他资料")}</p>${card(r)}</div>`,
        )
        .join("")
    : `<p class="card">${query ? `没有找到与“${escapeHtml(query)}”相关的资料或作品。` : "暂无资料。"}</p>`;
  const groups = new Map<string, { title: string; productionId: number | null; rows: ResourceRow[] }>();
  for (const row of rows) {
    const key = row.production_id === null ? "other" : String(row.production_id);
    const group = groups.get(key) || {
      title: row.production_title || "其他资料",
      productionId: row.production_id,
      rows: [],
    };
    group.rows.push(row);
    groups.set(key, group);
  }
  const groupedCards = groups.size
    ? [...groups.values()]
        .map((group) => {
          const photos = group.rows.filter((row) => row.res_type === "photo");
          const others = group.rows.filter((row) => row.res_type !== "photo");
          const gallery = photos.length
            ? `<article class="card photo-archive"><p class="eyebrow">剧照 · ${photos.length} 张</p><h3>剧照集</h3><div class="photo-grid">${photos.map((photo) => `<a href="/resources/${photo.id}" title="${escapeHtml(photo.title)}"><img src="/resources/${photo.id}/preview" alt="${escapeHtml(photo.title)}"></a>`).join("")}</div></article>`
            : "";
          const entries = [
            ...(gallery ? [{ createdAt: photos[0].created_at, html: gallery }] : []),
            ...others.map((row) => ({ createdAt: row.created_at, html: card(row) })),
          ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
          return `<section class="archive-group"><h2>${group.productionId ? `<a href="/productions/${group.productionId}">${escapeHtml(group.title)}</a>` : "其他资料"}</h2><p class="muted">按提交时间排列，最新资料在前。</p><div class="card-grid">${entries.map((entry) => entry.html).join("")}</div></section>`;
        })
        .join("")
    : `<p class="card">${query ? `没有找到与“${escapeHtml(query)}”相关的资料或作品。` : "暂无资料。"}</p>`;
  const canSubmit = true;
  return layout(
    mine ? "我的资料" : "资料库",
    `${archiveTabs("resources")}<section class="page-heading"><p class="eyebrow">ARCHIVE</p><h1>${mine ? "我的资料与审核结果" : "资料库"}</h1><p><a href="/resources">已入库资料</a> · <a href="/my-resources">我的提交</a>${canSubmit ? ' · <a href="/resources/submit">提交资料</a>' : ""}</p>${mine ? "" : `<form class="filters resource-search" method="get" action="/resources" role="search"><label>搜索资料或作品<input type="search" name="q" value="${escapeHtml(query)}" maxlength="100" placeholder="输入资料标题、文件名或作品名称"></label><button>搜索</button>${query ? '<a class="button secondary" href="/resources">清除</a>' : ""}</form>${query ? `<p class="search-summary">找到 ${rows.length} 项与“${escapeHtml(query)}”相关的资料。</p>` : ""}`}</section><section class="review-grid">${mine ? flatCards : groupedCards}</section>`,
    Boolean(user),
    user?.role === "admin",
  );
}
export function resourceDetailPage(row: ResourceRow, user: UserSession | null): string {
  const download =
    row.status === "approved"
      ? `<p><a class="button" href="/resources/${row.id}/download">下载文件</a></p>`
      : row.status === "pending"
        ? '<p class="notice">文件已安全保存，等待管理员审核后开放下载。</p>'
        : "";
  const edit =
    user?.role === "admin"
      ? `<p><a class="edit-link" href="/admin/resources/${row.id}/edit">编辑或删除这份资料</a></p>`
      : "";
  return layout(
    row.title,
    `${archiveTabs("resources")}<p class="back-links"><a href="${user?.id === row.uploader_id ? "/my-resources" : "/resources"}">← 返回资料列表</a><a href="/productions">返回作品档案</a></p><article class="card production-detail resource-detail"><p class="eyebrow">${escapeHtml(labels[row.res_type] || row.res_type)} · ${escapeHtml(statuses[row.status] || row.status)}</p><h1>${escapeHtml(row.title)}</h1>${edit}${resourceDetailPreview(row, Boolean(user))}<div class="resource-metadata"><p>${escapeHtml(row.description || "暂无说明")}</p><p>所属作品：${row.production_id ? `<a href="/productions/${row.production_id}">${escapeHtml(row.production_title)}</a>` : "其他资料"}</p><p>原文件名：${escapeHtml(row.original_name)}</p><p>提交人：${escapeHtml(row.uploader_name || "未知")}</p>${user && (user.id === row.uploader_id || user.role === "admin") && row.admin_note ? `<p class="alert">审核说明：${escapeHtml(row.admin_note)}</p>` : ""}${download}</div></article>`,
    Boolean(user),
    user?.role === "admin",
  );
}
export function resourceFormPage(
  productions: Array<{ id: number; title: string }>,
  csrf: string,
  admin: boolean,
  selectedProductionId: number | null = null,
): string {
  return layout(
    "上传资料",
    `${archiveTabs("resources")}<p class="back-links"><a href="/resources">← 返回资料库</a><a href="/productions">返回作品档案</a></p><section class="card auth wide"><h1>上传资料</h1><p class="notice">测试阶段暂不支持视频。剧照 20MB、剧本 50MB、音频与其他资料 100MB；剧照可以一次选择多张，每张会生成独立资料。认证队员通过规则后自动入库，普通账号提交后由管理员审核。</p><form id="resource-upload" method="post" data-csrf="${escapeHtml(csrf)}"><label>资料标题<input name="title" maxlength="100"><span class="hint">单个文件请填写标题；批量剧照会使用每张图片的文件名。</span></label><label>类型<select name="res_type"><option value="video">视频</option><option value="script">剧本</option><option value="photo" selected>剧照</option><option value="audio">音频</option><option value="other">其他</option></select></label><label>所属作品<select name="production_id"><option value="">其他资料</option>${productions.map((p) => `<option value="${p.id}"${selectedProductionId === p.id ? " selected" : ""}>${escapeHtml(p.title)}</option>`).join("")}</select></label><p class="missing-production"><strong>资料对应的戏还没新建？</strong> <a href="/suggestions?type=production&amp;source=upload">申请管理员新建作品档案</a></p><label>选择文件<input name="file" type="file" required><span class="hint" id="file-hint">选择“剧照”后可以一次选择多张图片。</span></label><label>说明<textarea name="description" maxlength="2000" rows="5"></textarea></label><div class="upload-feedback"><progress id="upload-progress" value="0"></progress><output id="upload-percent" for="upload-progress">0%</output><p id="upload-status" class="muted" role="status" aria-live="polite">尚未开始上传。</p></div><div class="upload-actions"><button type="submit">开始上传</button><button type="button" id="upload-cancel" class="secondary" hidden>取消当前文件</button></div></form><script src="/upload.js" defer></script></section>`,
    true,
    admin,
  );
}
export function resourcePermissionPage(): string {
  return layout(
    "提交资料",
    '<section class="card auth"><p class="eyebrow">ARCHIVE CONTRIBUTION</p><h1>提交资料需要队员认证</h1><p>完成队员认证后，你可以上传剧本、剧照和音频（测试阶段暂不支持视频）；管理员审核通过后才会进入资料库。</p><p><a class="button" href="/profile/member-application">申请队员认证</a></p><p><a href="/resources">先浏览资料库</a></p></section>',
    true,
  );
}
export function resourceReviewsPage(rows: ResourceRow[], csrf: string): string {
  const cards = rows.length
    ? rows
        .map(
          (r) =>
            `<article class="card"><h2>${escapeHtml(r.title)}</h2><p>提交人：${escapeHtml(r.uploader_name)} · ${escapeHtml(labels[r.res_type])} · ${escapeHtml(r.production_title || "其他资料")}</p><p>${escapeHtml(r.description)}</p><p>文件：${escapeHtml(r.original_name)}</p><form method="post" action="/admin/resources/${r.id}/review"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>审核说明<input name="admin_note" maxlength="1000"></label><button name="decision" value="approve">通过入库</button> <button class="secondary" name="decision" value="reject">驳回</button></form></article>`,
        )
        .join("")
    : '<p class="card">没有待审核资料。</p>';
  return layout(
    "资料审核",
    `<section class="page-heading"><h1>资料审核</h1></section><section class="review-grid">${cards}</section>`,
    true,
    true,
  );
}
export function resourceAdminPage(rows: ResourceRow[]): string {
  const cards = rows.length
    ? rows
        .map(
          (r) =>
            `<article class="card"><p class="eyebrow">${escapeHtml(statuses[r.status] || r.status)} · ${escapeHtml(labels[r.res_type] || r.res_type)}</p><h2><a href="/resources/${r.id}">${escapeHtml(r.title)}</a></h2><p>${escapeHtml(r.production_title || "其他资料")} · ${escapeHtml(r.uploader_name || "未知提交人")}</p><a href="/admin/resources/${r.id}/edit">编辑或删除</a></article>`,
        )
        .join("")
    : '<p class="card">暂无资料。</p>';
  return layout(
    "资料管理",
    `<section class="page-heading"><h1>资料管理</h1><p><a href="/admin/resources/reviews">查看待审核资料</a></p></section><section class="review-grid">${cards}</section>`,
    true,
    true,
  );
}
export function resourceEditPage(
  row: ResourceRow,
  productions: Array<{ id: number; title: string }>,
  csrf: string,
  saved: boolean,
): string {
  return layout(
    "编辑资料",
    `<section class="card auth"><h1>编辑资料</h1>${saved ? '<p class="notice">资料信息已保存。</p>' : ""}<form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>资料标题<input name="title" maxlength="100" value="${escapeHtml(row.title)}" required></label><label>类型<select name="res_type">${Object.entries(
      labels,
    )
      .map(([value, label]) => `<option value="${value}"${row.res_type === value ? " selected" : ""}>${label}</option>`)
      .join(
        "",
      )}</select></label><label>所属作品<select name="production_id"><option value="">其他资料</option>${productions.map((p) => `<option value="${p.id}"${row.production_id === p.id ? " selected" : ""}>${escapeHtml(p.title)}</option>`).join("")}</select></label><label>说明<textarea name="description" maxlength="2000" rows="6">${escapeHtml(row.description)}</textarea></label><button>保存资料信息</button></form><hr>${row.status === "approved" ? `<form method="post" action="/admin/resources/${row.id}/revoke"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">撤销入库，重新审核</button></form>` : ""}<hr><form method="post" action="/admin/resources/${row.id}/delete" data-confirm="确定删除这份资料和文件吗？此操作无法撤销。"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">删除资料与文件</button></form></section>`,
    true,
    true,
  );
}
