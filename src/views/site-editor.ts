import { escapeHtml as e } from "../views";
import type { SiteProfileRow } from "../routes/content";
import { validAccent, DEFAULT_ACCENT } from "../services/theme";
export function siteEditor(
  p: SiteProfileRow,
  productions: Array<{ id: number; title: string; year: number | null }>,
  photos: Array<{ id: number; title: string }>,
  csrf: string,
  saved: boolean,
): string {
  let t: Record<string, string> = {};
  try {
    t = JSON.parse(p.page_texts || "{}");
  } catch {}
  const input = (name: string, label: string, value: unknown, type = "text") =>
    `<label>${label}<input name="${name}" type="${type}" value="${e(value)}"></label>`;
  const area = (name: string, label: string, value: unknown) =>
    `<label>${label}<textarea name="${name}" rows="4" maxlength="10000">${e(value)}</textarea></label>`;
  const image = (name: string, label: string, value: string, empty: string) =>
    `<label>${label}<select name="${name}"><option value="">${empty}</option>${photos.map((photo) => `<option value="${photo.id}"${String(photo.id) === value ? " selected" : ""}>${e(photo.title)}</option>`).join("")}</select></label>`;
  const color = validAccent(t.brand_accent || "") ? t.brand_accent : DEFAULT_ACCENT;
  const section = (id: string, title: string, content: string) =>
    `<section class="site-edit-section" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${content}</section>`;
  return `<section class="card wide site-editor"><h1>页面编辑</h1>${saved ? '<p class="notice">页面内容已保存。</p>' : ""}<form method="post"><input type="hidden" name="csrf" value="${e(csrf)}">
 ${section("appearance", "整站外观编辑", `<p>整站颜色联动变化，保存后生效。作品可在各自编辑页单独选色。</p><div data-theme-editor>${input("brand_accent", "主题颜色编号", color)}<label>色盘<input type="color" value="${color}" data-theme-picker></label><button type="button" data-theme-reset>恢复默认</button> <button type="button" class="secondary" data-theme-cancel>取消颜色修改</button><p role="status" data-theme-status></p><div class="theme-sample">当前页面即为预览</div></div>`)}
 ${section("featured_production_id", "精选大戏编辑", `<label>精选大戏<select name="featured_production_id"><option value="">不展示精选作品</option>${productions.map((x) => `<option value="${x.id}"${p.featured_production_id === x.id ? " selected" : ""}>${e(x.title)}</option>`).join("")}</select></label>`)}
 ${section("section_backgrounds", "背景图片编辑", `<div id="home_welcome">${image("hero_photo", "首页背景", p.hero_photo, "自动选择精选作品或最新剧照")}${image("mascot_photo", "本周明星照片", t.mascot_photo || "", "默认照片（小象）")}</div>${image("productions_background", "作品与资料背景", t.productions_background || "", "纯色背景")}${image("members_background", "队员与剧团背景", t.members_background || "", "纯色背景")}${image("thanks_background", "鸣谢背景", t.thanks_background || "", "纯色背景")}`)}
 ${section("about_heading", "招新页面编辑", `${area("about_heading", "第二幕标题（自动去除标点）", t.about_heading || "在黑匣子\n一起成为故事")}<div id="about_text">${area("about_text", "剧团介绍正文", t.about_text || "我们是某大学生艺术团话剧队！祝大家晚安！")}</div>${area("recruitment", "招新正文", p.recruitment)}${area("requirements", "招新补充说明", p.requirements)}<div id="recruitment_poster">${image("recruitment_poster", "通用海报", t.recruitment_poster || "", "不设置")}${image("recruitment_poster_mobile", "手机海报", t.recruitment_poster_mobile || "", "沿用通用海报")}${input("recruitment_poster_alt", "海报文字说明", t.recruitment_poster_alt || "")}</div>`)}
 ${section("contact_intro", "联系信息编辑", `${input("troupe_name", "剧团名称", p.troupe_name)}${input("contact_email", "联系邮箱", p.contact_email, "email")}${input("qq_group", "招新QQ群", p.qq_group)}`)}
 ${section("special_thanks", "致谢编辑", `<p>显示在鸣谢页的网站贡献者上方，留空则隐藏。支持分段文字。</p>${area("special_thanks", "想对大家说的话", t.special_thanks || "")}`)}
 ${section("test_notice", "测试须知编辑", area("test_notice", "确认后不再重复；内容修改后重新提示", t.test_notice || "网站正在测试，暂不支持视频上传。欢迎提交建议。"))}
 <button>保存页面内容</button></form></section>`;
}
