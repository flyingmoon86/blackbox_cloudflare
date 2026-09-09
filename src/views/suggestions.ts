import type { SuggestionRow } from "../routes/suggestions";
import { escapeHtml, layout } from "../views";

export function suggestionFormPage(
  csrf: string,
  sent: boolean,
  admin: boolean,
  category: "website" | "production",
  source: "productions" | "upload",
): string {
  const productionRequest = category === "production";
  const returnPath = source === "productions" ? "/productions" : "/resources/submit";
  const returnLabel = source === "productions" ? "作品档案" : "上传资料";
  return layout(
    productionRequest ? "申请新建作品档案" : "意见箱",
    `<section class="card auth"><p class="eyebrow">${productionRequest ? "NEW PRODUCTION" : "SUGGESTION BOX"}</p><h1>${productionRequest ? "申请新建作品档案" : "网站意见箱"}</h1>${sent ? `<p class="notice">${productionRequest ? "建档申请" : "建议"}已经送到管理员收件箱。</p>` : ""}<p>${productionRequest ? "找不到要加入或补充资料的作品时，请先提交结构化建档申请。管理员建档后，你就能从作品卡片继续操作。" : "可以告诉我们哪里不好用、哪里看不懂，或希望增加什么。请不要在这里填写密码等敏感信息。"}</p><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="category" value="${category}"><input type="hidden" name="source" value="${source}">${productionRequest ? '<label>作品名称<input name="production_title" maxlength="100" required></label><label>演出年份（不确定可不填）<input name="production_year" type="number" min="1" max="9999" inputmode="numeric"></label><label>补充说明<textarea name="content" maxlength="3000" rows="6" placeholder="例如演出场次、你的参与经历，或希望补充的资料"></textarea></label>' : '<label>建议内容<textarea name="content" maxlength="3000" rows="8" required></textarea></label>'}<button>${productionRequest ? "提交建档申请" : "提交建议"}</button></form><p><a href="${productionRequest ? returnPath : "/"}">返回${productionRequest ? returnLabel : "首页"}</a></p></section>`,
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
            `<article class="card"><p class="eyebrow">${row.category === "production" ? "作品建档申请" : "网站建议"} · ${row.status === "open" ? "待处理" : "已处理"} · ${escapeHtml(row.created_at.slice(0, 16))}</p><h2>${row.category === "production" ? escapeHtml(row.production_title || "未填写作品名") : escapeHtml(row.username)}</h2>${row.category === "production" ? `<p>申请人：${escapeHtml(row.username)}${row.production_year ? ` · 演出年份：${row.production_year}` : ""}</p>` : ""}<p class="preline">${escapeHtml(row.content)}</p>${row.admin_note ? `<p class="notice">管理员记录：${escapeHtml(row.admin_note)}</p>` : ""}<form method="post" action="/admin/suggestions/${row.id}/resolve"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>处理记录（可选）<input name="admin_note" maxlength="1000" value="${escapeHtml(row.admin_note)}"></label><button>${row.status === "open" ? "标记已处理" : "更新处理记录"}</button></form></article>`,
        )
        .join("")
    : '<p class="card">收件箱里还没有建议。</p>';
  return layout(
    "意见箱收件箱",
    `<section class="page-heading"><p class="eyebrow">ADMIN INBOX</p><h1>建议与建档申请</h1><p>网站建议和队员提交的作品建档申请都会集中在这里。</p></section><section class="review-grid">${items}</section>`,
    true,
    true,
  );
}
