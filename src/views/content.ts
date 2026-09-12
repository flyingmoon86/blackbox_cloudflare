import { DEFAULT_ACCENT, validAccent } from "../services/theme";
import type { AnnouncementRow, SiteProfileRow } from "../routes/content";
import { escapeHtml, layout } from "../views";
import { ADMIN_GUIDE_DEFAULT, MEMBER_GUIDE_DEFAULT } from "./help";

export function announcementListPage(items: AnnouncementRow[], admin: boolean, csrf: string, signedIn = true): string {
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
    signedIn,
    admin,
  );
}
export function announcementDetailPage(item: AnnouncementRow, admin: boolean, csrf: string, signedIn = true): string {
  return layout(
    item.title,
    `<article class="card profile-detail"><p class="eyebrow">${escapeHtml(item.created_at.slice(0, 10))}</p><h1>${escapeHtml(item.title)}</h1><p class="preline">${escapeHtml(item.content)}</p>${admin ? `<form method="post" action="/admin/announcements/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">删除公告</button></form>` : ""}<p><a href="/announcements">返回公告列表</a></p></article>`,
    signedIn,
    admin,
  );
}
export function announcementFormPage(csrf: string): string {
  return layout(
    "发布公告",
    `<section class="card auth"><p class="eyebrow">NOTICE EDITOR</p><h1>发布公告</h1><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>标题<input name="title" maxlength="100" required></label><label>正文<textarea name="content" rows="10"></textarea></label><button>发布</button></form></section>`,
    true,
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
  const accent = validAccent(texts.brand_accent || "") ? texts.brand_accent : DEFAULT_ACCENT;
  const photoOptions = (selected: string) =>
    photos
      .map(
        (x) => `<option value="${x.id}"${selected === String(x.id) ? " selected" : ""}>${escapeHtml(x.title)}</option>`,
      )
      .join("");
  return layout(
    "页面管理",
    `<section class="card wide"><p class="eyebrow">SITE CONTENT</p><h1>页面管理</h1>${saved ? '<p class="notice">页面内容已保存。</p>' : ""}<form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <h2 id="home_welcome">首页封面</h2><label>认证队员欢迎语<input name="home_welcome" value="${escapeHtml(texts.home_welcome || "黑匣子永远是你的家")}"></label><label>访客与普通账号欢迎语<input name="visitor_welcome" value="${escapeHtml(texts.visitor_welcome || "这里是黑匣子")}"></label><label>首页首屏剧照<select name="hero_photo"><option value="">使用默认背景</option>${photoOptions(p.hero_photo)}</select><span class="hint">用于首页欢迎区，只显示审核通过的剧照。</span></label><label>全站模糊背景剧照<select name="page_background_photo"><option value="">使用纯色背景</option>${photoOptions(p.page_background_photo)}</select><span class="hint">剧照会在所有页面底部重度模糊、降低明度和透明度，正文仍保持清晰。</span></label><label>首页小象图片<select name="mascot_photo"><option value="">使用默认小象</option>${photoOptions(texts.mascot_photo || "")}</select></label><label>精选大戏<select name="featured_production_id"><option value="">暂不设置</option>${productionOptions}</select></label>
  <h2 id="appearance">外观</h2><p>选择品牌强调色，系统自动搭配深浅页面。预览仅你可见，保存后生效。</p><div data-theme-editor><label>颜色编号<input name="brand_accent" value="${escapeHtml(accent)}" pattern="#[0-9a-fA-F]{6}" maxlength="7" required data-theme-hex></label><label>色盘<input type="color" value="${escapeHtml(accent)}" data-theme-picker></label><button type="button" data-theme-reset>恢复默认</button> <button type="button" class="secondary" data-theme-cancel>取消颜色修改</button><p role="status" data-theme-status></p><div class="theme-sample"><a href="#appearance">链接示例</a> · <button type="button">主按钮示例</button></div></div>
 <h2 id="recruitment_poster">招新海报</h2><p>横竖海报完整展示，点击放大。手机未设置时沿用通用图。<a href="/resources/submit">上传新海报</a></p><label>通用海报<select name="recruitment_poster" data-poster-select><option value="">不展示海报</option>${photoOptions(texts.recruitment_poster || "")}</select></label><label>手机专用海报<select name="recruitment_poster_mobile" data-poster-select><option value="">沿用通用海报</option>${photoOptions(texts.recruitment_poster_mobile || "")}</select></label><label>海报说明<input name="recruitment_poster_alt" maxlength="200" value="${escapeHtml(texts.recruitment_poster_alt || "")}"></label><div class="poster-settings-preview"><figure>通用预览<img data-poster-preview="recruitment_poster" alt="通用海报预览" hidden></figure><figure>手机预览<img data-poster-preview="recruitment_poster_mobile" alt="手机海报预览" hidden></figure></div>
  <h2 id="test_notice">测试须知</h2><label>访客首次进入时显示<textarea name="test_notice" maxlength="10000" rows="6">${escapeHtml(texts.test_notice || "网站正在测试中。你可以浏览和试用功能；认证队员还可以通过首页意见箱提交建议。请勿上传敏感或无权分享的资料。")}</textarea><span class="hint">访客确认后不重复显示；修改这里的内容后会再次显示。</span></label>
  <h2 id="about_text">剧团信息</h2><label>剧团名称<input name="troupe_name" maxlength="100" value="${escapeHtml(p.troupe_name)}"></label><label>剧团介绍<textarea name="introduction" rows="5">${escapeHtml(p.introduction)}</textarea></label><label>首页“关于我们”文案<textarea name="about_text" rows="4">${escapeHtml(texts.about_text)}</textarea></label>
  <h2 id="contact_intro">联系我们</h2><label>联系说明<textarea name="contact_intro" rows="3">${escapeHtml(texts.contact_intro)}</textarea></label><label>邮箱<input name="contact_email" type="email" value="${escapeHtml(p.contact_email)}"></label><label>微信<input name="contact_wechat" value="${escapeHtml(p.contact_wechat)}"></label><label>QQ群<input name="qq_group" value="${escapeHtml(p.qq_group)}"></label><label>公众号<input name="public_account" value="${escapeHtml(p.public_account)}"></label><label>招新说明<textarea name="recruitment" rows="4">${escapeHtml(p.recruitment)}</textarea></label><label>招新要求<textarea name="requirements" rows="4">${escapeHtml(p.requirements)}</textarea></label>
  <h2 id="member_guide">队员指南</h2><p class="hint">这里填写剧团自己的约定；网站会在指南页另行展示固定操作步骤和快捷入口。</p><label>公开队员指南内容<textarea name="member_guide" maxlength="10000" rows="10">${escapeHtml(texts.member_guide || MEMBER_GUIDE_DEFAULT)}</textarea></label><h2 id="admin_guide">管理员指南</h2><p class="hint">仅管理员可见，可记录本队审核标准、资料命名方式和交接事项。</p><label>仅管理员可见内容<textarea name="admin_guide" maxlength="10000" rows="10">${escapeHtml(texts.admin_guide || ADMIN_GUIDE_DEFAULT)}</textarea></label><button>保存页面内容</button></form></section>`,
    true,
    true,
  );
}
