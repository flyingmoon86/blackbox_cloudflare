import { escapeHtml } from "../views";
import { icon } from "./shared";

export function adminNavigation(path: string, publicSite?: string): string {
  const item = (href: string, label: string, glyph: string, active = path === href) =>
    `<a href="${href}"${active ? ' aria-current="page"' : ""}>${icon(glyph)}<span>${label}</span></a>`;
  return `<aside class="workspace-sidebar"><details class="workspace-navigation" open><summary>管理员操作与记录 <span aria-hidden="true">⌄</span></summary><nav aria-label="后台工作导航">
    ${item("/admin", "工作台", "home")}
    ${item("/admin/member-requests", "队员认证", "members")}
    <p class="workspace-caption">管理员操作</p>
    <div class="workspace-actions">
    ${item("/admin/productions/new", "创建作品", "productions")}
    ${item("/admin/members/new", "新建队员", "members")}
    ${item("/admin/credit-imports/new", "批量导入演职人员", "productions")}
    ${item("/resources/submit", "上传资料", "resources")}
    ${item("/admin/announcements/new", "发布公告", "help")}
    ${item("/admin/site", "编辑网站页面", "help")}
    </div>
    ${item("/admin/resources", "资料管理", "resources", path.startsWith("/admin/resources") && path !== "/admin/resources/reviews")}
    <p class="workspace-caption">记录与设置</p>
    ${item("/admin/credit-imports", "导入记录", "productions", path.startsWith("/admin/credit-imports") && path !== "/admin/credit-imports/new")}
    ${item("/admin/review-history", "审核记录", "help")}
    ${item("/admin/accounts", "账号管理", "account")}
    ${item("/admin/system", "系统信息", "resources", path.startsWith("/admin/system"))}
    <div class="workspace-sidebar-footer"><a href="${escapeHtml(publicSite || "/")}"${publicSite ? ' target="_blank" rel="noopener"' : ""}>查看正式网站 <span aria-hidden="true">↗</span></a></div>
    </nav></details></aside>`;
}
