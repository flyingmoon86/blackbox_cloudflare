import type { SuggestionRow } from "../routes/suggestions";
import { escapeHtml, layout } from "../views";

export function suggestionFormPage(csrf: string, sent: boolean, admin: boolean): string {
  return layout(
    "意见箱",
    `<section class="card auth"><p class="eyebrow">SUGGESTION BOX</p><h1>网站意见箱</h1>${sent ? '<p class="notice">建议已经送到管理员收件箱，谢谢你的反馈。</p>' : ""}<p>可以告诉我们哪里不好用、哪里看不懂，或希望增加什么。请不要在这里填写密码等敏感信息。</p><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>建议内容<textarea name="content" maxlength="3000" rows="8" required></textarea></label><button>提交建议</button></form><p><a href="/">返回首页</a></p></section>`,
    true,
    admin,
  );
}

export function suggestionPermissionPage(admin: boolean): string {
  return layout(
    "意见箱",
    '<section class="card auth"><p class="eyebrow">SUGGESTION BOX</p><h1>认证队员意见箱</h1><p>意见箱目前向认证队员开放。你可以先在个人中心申请队员认证，或通过联系邮箱反馈。</p><p><a class="button" href="/profile/member-application">申请队员认证</a></p></section>',
    true,
    admin,
  );
}

export function suggestionInboxPage(rows: SuggestionRow[], csrf: string): string {
  const items = rows.length
    ? rows
        .map(
          (row) =>
            `<article class="card"><p class="eyebrow">${row.status === "open" ? "待处理" : "已处理"} · ${escapeHtml(row.created_at.slice(0, 16))}</p><h2>${escapeHtml(row.username)}</h2><p class="preline">${escapeHtml(row.content)}</p>${row.admin_note ? `<p class="notice">管理员记录：${escapeHtml(row.admin_note)}</p>` : ""}<form method="post" action="/admin/suggestions/${row.id}/resolve"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>处理记录（可选）<input name="admin_note" maxlength="1000" value="${escapeHtml(row.admin_note)}"></label><button>${row.status === "open" ? "标记已处理" : "更新处理记录"}</button></form></article>`,
        )
        .join("")
    : '<p class="card">收件箱里还没有建议。</p>';
  return layout(
    "意见箱收件箱",
    `<section class="page-heading"><p class="eyebrow">ADMIN INBOX</p><h1>网站建议收件箱</h1></section><section class="review-grid">${items}</section>`,
    true,
    true,
  );
}
