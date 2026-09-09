import { escapeHtml, layout } from "../views";

const paragraph = (value: string): string => `<p class="preline">${escapeHtml(value)}</p>`;

export function helpPage(texts: Record<string, string>, admin: boolean): string {
  const memberGuide = texts.member_guide || "在作品与资料中浏览档案；认证队员可提交资料，并在个人中心维护自己的简介。";
  const adminGuide = texts.admin_guide || "在管理员工作台审核申请和资料，并管理作品、公告及页面内容。";
  return layout("使用指南", `<section class="page-heading"><p class="eyebrow">HELP</p><h1>使用指南</h1></section><section class="review-grid"><article class="card"><h2>队员指南</h2>${admin ? '<a class="edit-link" href="/admin/site#member_guide">编辑这段指南</a>' : ""}${paragraph(memberGuide)}</article>${admin ? `<article class="card"><h2>管理员指南</h2><a class="edit-link" href="/admin/site#admin_guide">编辑这段指南</a>${paragraph(adminGuide)}</article>` : ""}</section>`, true);
}
