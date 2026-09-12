import { escapeHtml as e } from "../views";
import type { SiteProfileRow } from "../routes/content";
import { validAccent, DEFAULT_ACCENT } from "../services/theme";
import { MEMBER_GUIDE_DEFAULT, ADMIN_GUIDE_DEFAULT } from "./help";
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
  return `<section class="card wide"><h1>页面管理</h1>${saved ? '<p class="notice">页面内容已保存。</p>' : ""}<form method="post"><input type="hidden" name="csrf" value="${e(csrf)}">
 <h2 id="home_welcome">首页画面</h2><p>首屏保留“黑匣子 永远是你家”，不再显示重复欢迎语。</p>
 ${image("hero_photo", "首页背景", p.hero_photo, "自动选择精选作品或最新剧照")}${image("page_background_photo", "全站模糊背景", p.page_background_photo, "纯色背景")}${image("mascot_photo", "首页小象", t.mascot_photo || "", "默认小象")}
 <label>精选大戏<select name="featured_production_id"><option value="">不展示精选作品</option>${productions.map((x) => `<option value="${x.id}"${p.featured_production_id === x.id ? " selected" : ""}>${e(x.title)}</option>`).join("")}</select></label>
 <h2 id="about_heading">第二幕文字</h2>${area("about_heading", "第二幕标题（自动去除标点）", t.about_heading || "在黑匣子\n一起成为故事")}${area("about_text", "剧团介绍正文", t.about_text || "我们是某大学生艺术团话剧队！祝大家晚安！")}${area("recruitment", "招新正文", p.recruitment)}${area("requirements", "招新补充说明", p.requirements)}
 <h2 id="recruitment_poster">招新海报</h2>${image("recruitment_poster", "通用海报", t.recruitment_poster || "", "不设置")}${image("recruitment_poster_mobile", "手机海报", t.recruitment_poster_mobile || "", "沿用通用海报")}${input("recruitment_poster_alt", "海报文字说明", t.recruitment_poster_alt || "")}
 <h2 id="contact_intro">联系信息</h2>${input("troupe_name", "剧团名称", p.troupe_name)}${input("contact_email", "联系邮箱", p.contact_email, "email")}${input("qq_group", "招新QQ群", p.qq_group)}
 <h2 id="appearance">整站外观</h2><p>整站颜色联动变化，保存后生效。作品可在各自编辑页单独选色。</p><div data-theme-editor>${input("brand_accent", "主题颜色编号", color)}<label>色盘<input type="color" value="${color}" data-theme-picker></label><button type="button" data-theme-reset>恢复默认</button> <button type="button" class="secondary" data-theme-cancel>取消颜色修改</button><p role="status" data-theme-status></p><div class="theme-sample">当前页面即为预览</div></div>
 <h2 id="test_notice">测试须知</h2>${area("test_notice", "确认后不再重复；内容修改后重新提示", t.test_notice || "网站正在测试，暂不支持视频上传。欢迎提交建议。")}
 <h2 id="member_guide">队员须知</h2>${area("member_guide", "公开须知", t.member_guide || MEMBER_GUIDE_DEFAULT)}<h2 id="admin_guide">管理员须知</h2>${area("admin_guide", "仅管理员可见", t.admin_guide || ADMIN_GUIDE_DEFAULT)}<button>保存页面内容</button></form></section>`;
}
