import { escapeHtml as e } from "../views";
import { stageEditor } from "./stage-editor";
import { assetUrl } from "./assets";
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
    `<label>${label}<select name="${name}"><option value="">${empty}</option>${value && !photos.some((photo) => String(photo.id) === value) ? `<option value="${e(value)}" selected>当前图片 #${e(value)}（暂不可用）</option>` : ""}${photos.map((photo) => `<option value="${photo.id}"${String(photo.id) === value ? " selected" : ""}>${e(photo.title)}</option>`).join("")}</select></label>`;
  const color = validAccent(t.brand_accent || "") ? t.brand_accent : DEFAULT_ACCENT;
  const section = (id: string, title: string, content: string) =>
    `<section class="site-edit-section" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${content}</section>`;
  const panel = (key: string, content: string) =>
    `<div id="site-panel-${key}" class="site-editor-panel" data-site-panel aria-labelledby="site-tab-${key}">${content}</div>`;
  const groups = [
    ["backgrounds", "背景图片", "section_backgrounds"],
    ["home", "精选大戏", "featured_production_id"],
    ["troupe", "招新信息", "about_heading"],
    ["messages", "鸣谢与提示", "special_thanks"],
    ["appearance", "颜色", "appearance"],
  ];
  return `<link rel="stylesheet" href="${assetUrl("/site-editor.css")}"><script src="${assetUrl("/site-editor.js")}" defer></script><section class="card wide site-editor" data-site-editor><h1>页面编辑</h1>${saved ? '<p class="notice">页面内容已保存。</p>' : ""}<p class="site-editor-intro">按分区编辑网站内容，切换分区会保留当前修改。</p><nav class="site-editor-nav" data-site-nav aria-label="页面编辑分区">${groups.map(([key, title, anchor]) => `<a id="site-tab-${key}" href="#${anchor}" aria-controls="site-panel-${key}">${title}</a>`).join("")}</nav><form method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${e(csrf)}">
 ${panel("backgrounds", section("section_backgrounds", "背景图片", stageEditor(p.page_texts)))}
 <div id="site-panel-appearance" class="site-editor-panel" data-site-panel aria-labelledby="site-tab-appearance">
 ${section("appearance", "颜色", `<p>整站颜色联动变化，保存后生效。作品可在各自编辑页单独选色。</p><div data-theme-editor>${input("brand_accent", "主题颜色编号", color)}<label>色盘<input type="color" value="${color}" data-theme-picker></label><button type="button" data-theme-reset>恢复默认</button> <button type="button" class="secondary" data-theme-cancel>取消颜色修改</button><p role="status" data-theme-status></p><div class="theme-sample">当前页面即为预览</div></div>`)}
 </div><div id="site-panel-home" class="site-editor-panel" data-site-panel aria-labelledby="site-tab-home">
 ${section("featured_production_id", "精选大戏编辑", `<label>精选大戏<select name="featured_production_id"><option value="">不展示精选作品</option>${productions.map((x) => `<option value="${x.id}"${p.featured_production_id === x.id ? " selected" : ""}>${e(x.title)}</option>`).join("")}</select></label>`)}
 <input type="hidden" name="mascot_photo" value="${e(t.mascot_photo || "")}"><p id="home_welcome">首屏仅展示剧场背景；精选大戏展示在首页第二幕。原明星照片配置保留。</p>
 </div><div id="site-panel-troupe" class="site-editor-panel" data-site-panel aria-labelledby="site-tab-troupe">
 ${section("about_heading", "招新信息", `${area("about_heading", "剧团页标题（自动去除标点）", t.about_heading || "在黑匣子\n一起成为故事")}<div id="about_text">${area("about_text", "剧团介绍正文", t.about_text || "我们是某大学生艺术团话剧队！祝大家晚安！")}</div>${area("recruitment", "招新正文", p.recruitment)}${area("requirements", "招新补充说明", p.requirements)}<div id="recruitment_poster">${image("recruitment_poster", "通用海报", t.recruitment_poster || "", "不设置")}${image("recruitment_poster_mobile", "手机海报", t.recruitment_poster_mobile || "", "沿用通用海报")}${input("recruitment_poster_alt", "海报文字说明", t.recruitment_poster_alt || "")}</div>`)}
 ${section("contact_intro", "联系信息编辑", `${input("troupe_name", "剧团名称", p.troupe_name)}${input("contact_email", "联系邮箱", p.contact_email, "email")}${input("qq_group", "招新QQ群", p.qq_group)}`)}
 </div><div id="site-panel-messages" class="site-editor-panel" data-site-panel aria-labelledby="site-tab-messages">
 ${section("special_thanks", "致谢编辑", `<p>显示在鸣谢页的网站贡献者上方，留空则隐藏。支持分段文字。</p>${area("special_thanks", "想对大家说的话", t.special_thanks || "")}`)}
 ${section("test_notice", "测试须知编辑", area("test_notice", "确认后不再重复；内容修改后重新提示", t.test_notice || "网站正在测试，暂不支持视频上传。欢迎提交建议。"))}
 </div><div class="site-editor-save"><span>统一保存全部分区的修改</span><button type="submit">保存页面内容</button></div></form></section>`;
}
