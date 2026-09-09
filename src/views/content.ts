import type { AnnouncementRow, SiteProfileRow } from "../routes/content";
import { escapeHtml, layout } from "../views";

export function announcementListPage(items: AnnouncementRow[], admin: boolean, csrf: string): string {
  const rows = items.length
    ? items
        .map(
          (x) =>
            `<article class="card"><p class="eyebrow">${escapeHtml(x.created_at.slice(0, 10))}</p><h2><a href="/announcements/${x.id}">${escapeHtml(x.title)}</a></h2><p>${escapeHtml(x.content.slice(0, 160))}</p>${admin ? `<form method="post" action="/admin/announcements/${x.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary small">删除</button></form>` : ""}</article>`,
        )
        .join("")
    : '<p class="card">暂无公告。</p>';
  return layout(
    "公告",
    `<section class="page-heading"><p class="eyebrow">NOTICE</p><h1>剧团公告</h1>${admin ? '<a class="button" href="/admin/announcements/new">发布公告</a>' : ""}</section><section class="review-grid">${rows}</section>`,
    true,
  );
}
export function announcementDetailPage(item: AnnouncementRow, admin: boolean, csrf: string): string {
  return layout(
    item.title,
    `<article class="card profile-detail"><p class="eyebrow">${escapeHtml(item.created_at.slice(0, 10))}</p><h1>${escapeHtml(item.title)}</h1><p class="preline">${escapeHtml(item.content)}</p>${admin ? `<form method="post" action="/admin/announcements/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">删除公告</button></form>` : ""}<p><a href="/announcements">返回公告列表</a></p></article>`,
    true,
  );
}
export function announcementFormPage(csrf: string): string {
  return layout(
    "发布公告",
    `<section class="card auth"><p class="eyebrow">NOTICE EDITOR</p><h1>发布公告</h1><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>标题<input name="title" maxlength="100" required></label><label>正文<textarea name="content" rows="10"></textarea></label><button>发布</button></form></section>`,
    true,
  );
}
export function siteSettingsPage(
  p: SiteProfileRow,
  productions: Array<{ id: number; title: string; year: number | null }>,
  photos: Array<{ id: number; title: string }>,
  csrf: string,
  saved: boolean,
): string {
  let texts: Record<string, string> = {};
  try {
    texts = JSON.parse(p.page_texts || "{}");
  } catch {}
  const productionOptions = productions
    .map(
      (x) =>
        `<option value="${x.id}"${p.featured_production_id === x.id ? " selected" : ""}>${escapeHtml(x.title)}${x.year ? `（${x.year}）` : ""}</option>`,
    )
    .join("");
  const photoOptions = photos
    .map(
      (x) =>
        `<option value="${x.id}"${p.hero_photo === String(x.id) ? " selected" : ""}>${escapeHtml(x.title)}</option>`,
    )
    .join("");
  return layout(
    "页面管理",
    `<section class="card wide"><p class="eyebrow">SITE CONTENT</p><h1>页面管理</h1>${saved ? '<p class="notice">页面内容已保存。</p>' : ""}<form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <h2 id="home_welcome">首页封面</h2><label>欢迎语<input name="home_welcome" value="${escapeHtml(texts.home_welcome || "黑匣子永远是你的家")}"></label><label>首页背景剧照<select name="hero_photo"><option value="">使用默认背景</option>${photoOptions}</select><span class="hint">这里只显示审核通过的剧照。</span></label><label>精选大戏<select name="featured_production_id"><option value="">暂不设置</option>${productionOptions}</select></label>
  <h2 id="about_text">剧团信息</h2><label>剧团名称<input name="troupe_name" maxlength="100" value="${escapeHtml(p.troupe_name)}"></label><label>剧团介绍<textarea name="introduction" rows="5">${escapeHtml(p.introduction)}</textarea></label><label>首页“关于我们”文案<textarea name="about_text" rows="4">${escapeHtml(texts.about_text)}</textarea></label>
  <h2 id="contact_intro">联系我们</h2><label>联系说明<textarea name="contact_intro" rows="3">${escapeHtml(texts.contact_intro)}</textarea></label><label>邮箱<input name="contact_email" type="email" value="${escapeHtml(p.contact_email)}"></label><label>微信<input name="contact_wechat" value="${escapeHtml(p.contact_wechat)}"></label><label>QQ群<input name="qq_group" value="${escapeHtml(p.qq_group)}"></label><label>公众号<input name="public_account" value="${escapeHtml(p.public_account)}"></label><label>招新说明<textarea name="recruitment" rows="4">${escapeHtml(p.recruitment)}</textarea></label><label>招新要求<textarea name="requirements" rows="4">${escapeHtml(p.requirements)}</textarea></label>
  <h2 id="member_guide">队员指南</h2><label>登录用户可见内容<textarea name="member_guide" maxlength="10000" rows="10">${escapeHtml(texts.member_guide || "在作品与资料中浏览档案；认证队员可提交资料，并在个人中心维护自己的简介。")}</textarea></label><h2 id="admin_guide">管理员指南</h2><label>仅管理员可见内容<textarea name="admin_guide" maxlength="10000" rows="10">${escapeHtml(texts.admin_guide || "在管理员工作台审核申请和资料，并管理作品、公告及页面内容。")}</textarea></label><button>保存页面内容</button></form></section>`,
    true,
  );
}
