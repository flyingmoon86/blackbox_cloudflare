import { reviewQueue, reviewAttributes } from "./review-queue";
import type { JoinReview, ManagedUser, PendingCounts } from "../routes/admin";
import { escapeHtml, layout } from "../views";

export function adminDashboardPage(
  requests: JoinReview[],
  users: ManagedUser[],
  counts: PendingCounts,
  currentAdminId: number,
  csrf: string,
  message: string,
  section: "overview" | "members" | "accounts" = "overview",
): string {
  const notices: Record<string, string> = {
    approved: "申请已通过。",
    rejected: "申请已驳回。",
    "user-updated": "账号状态已更新。",
    "member-unlinked": "账号已与队员档案解绑；档案内容和历史关系均已保留。",
    "user-deleted": "账号已删除；队员档案和已入库资料均已保留。",
  };
  const requestRows = requests.length
    ? requests
        .map(
          (
            request,
          ) => `<article class="card review-card" ${reviewAttributes(request.id, request.apply_type === "bind" ? "绑定档案" : "新建档案", [request.username, request.member_name, request.name, request.cohort].join(" "))}><h3>${escapeHtml(request.username)} · ${request.apply_type === "bind" ? "绑定档案" : "新建档案"}</h3>
    <p>目标：${escapeHtml(request.member_name || request.name)}</p><p>核对信息：${escapeHtml(request.identity_note)}</p>
    ${request.apply_type === "new" ? `<p>届别：${escapeHtml(request.cohort || request.join_year || "未填写")}</p><p>${escapeHtml(request.bio)}</p>` : ""}
    <div class="admin-actions"><form method="post" action="/admin/requests/${request.id}/approve"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>通过</button></form>
    <form method="post" action="/admin/requests/${request.id}/reject"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input name="admin_note" aria-label="驳回理由" maxlength="1000" placeholder="驳回理由" required><button class="secondary">驳回</button></form></div></article>`,
        )
        .join("")
    : '<p class="card">当前没有待审核的队员申请。</p>';
  const userRows = users
    .map((user) => {
      const unlink =
        user.role === "member" && user.member_id
          ? `<details class="account-unlink"><summary>解绑档案</summary><form method="post" action="/admin/users/${user.id}/unlink-member"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><p>解绑“${escapeHtml(user.username)}”与“${escapeHtml(user.member_name)}”。队员档案和历史资料会保留，账号会变回普通用户。</p><label><input type="checkbox" name="confirm_unlink" value="yes" required>我确认解绑</label><button class="small danger">确认解绑</button></form></details>`
          : "";
      const remove =
        user.id !== currentAdminId
          ? `<details class="account-unlink account-delete"><summary>删除账号</summary><form method="post" action="/admin/users/${user.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><p>永久删除账号“${escapeHtml(user.username)}”。队员档案和已入库资料会保留，申请记录等账号数据会清除。</p><label>输入用户名确认<input name="confirm_username" autocomplete="off" required></label><button class="small danger">永久删除账号</button></form></details>`
          : "";
      return `<tr data-account-search="${escapeHtml([user.username, user.role, user.member_name, user.status].join(" "))}"><td data-label="用户名"><strong>${escapeHtml(user.username)}</strong>${user.id === currentAdminId ? '<span class="wb-tag">当前账号</span>' : ""}</td><td data-label="身份">${escapeHtml({ admin: "管理员", member: "队员", user: "普通用户" }[user.role])}</td><td data-label="队员档案">${escapeHtml(user.member_name || "未绑定")}</td><td data-label="状态"><span class="wb-tag ${user.status === "active" ? "is-active" : "is-disabled"}">${user.status === "active" ? "正常" : "已禁用"}</span></td><td data-label="操作"><div class="account-actions"><form method="post" action="/admin/users/${user.id}/toggle"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="small secondary">${user.status === "active" ? "禁用" : "启用"}</button></form>${unlink}${remove}</div></td></tr>`;
    })
    .join("");
  const pendingTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const tasks = [
    ["member", "队员认证", "/admin/member-requests", counts.member_requests],
    ["production-join", "作品加入", "/admin/production-requests", counts.production_joins],
    ["resource", "资料审核", "/admin/resources/reviews", counts.resource_reviews],
    ["production-create", "作品建档", "/admin/suggestions", counts.production_creates],
    ["suggestion,feedback", "网站建议", "/admin/community", counts.website_suggestions],
  ] as const;
  const taskCards = tasks
    .map(
      ([key, title, href, count]) =>
        `<div class="wb-task"><a href="${href}"><strong>${title}</strong><b data-workbench-count="${key}">${count}</b></a>${key === "suggestion,feedback" ? '<a class="wb-task-secondary" href="/admin/suggestions">历史建议 →</a>' : ""}</div>`,
    )
    .join("");
  const title = { overview: "管理员工作台", members: "队员认证", accounts: "账号管理" }[section];
  const introduction = {
    overview: "从待办开始，让新的故事顺利入档。",
    members: "核对每一份申请，让名字与档案准确相连。",
    accounts: "管理访问身份，保持档案与账号的关系清晰。",
  }[section];
  const currentPath = { overview: "/admin", members: "/admin/member-requests", accounts: "/admin/accounts" }[section];
  return layout(
    title,
    `<div class="workbench"${section === "overview" ? " data-workbench" : ""}>
    <header class="wb-heading"><div><p class="wb-heading-label">黑匣子 · 幕后工作</p><h1>${title}</h1><p class="wb-heading-description">${introduction}</p></div><a href="${currentPath}" data-workbench-reload>刷新${section === "overview" ? "工作台" : "列表"}</a></header>
    ${notices[message] ? `<p class="notice" role="status">${notices[message]}</p>` : ""}
    ${
      section === "overview"
        ? `<section class="wb-overview" aria-labelledby="dashboard-pending-title"><div class="wb-overview-title"><h2 id="dashboard-pending-title">待处理</h2><span class="wb-total"><strong data-workbench-total>${pendingTotal}</strong> 项</span></div>
    <p class="wb-empty" data-workbench-empty${pendingTotal ? " hidden" : ""}>当前待办已清空。</p>
    <nav class="wb-task-list" aria-label="待处理事项">${taskCards}</nav>
    <p class="wb-sync" data-workbench-sync role="status">当前为页面加载时快照；刷新可查看新申请。</p></section>
    `
        : ""
    }${
      section === "members"
        ? `<section class="wb-panel" id="member-requests" aria-labelledby="member-requests-title"><header class="wb-panel-head"><h2 id="member-requests-title">队员认证</h2><p>核对身份与档案；驳回时请填写理由。</p></header>${counts.member_requests ? reviewQueue("member", requestRows) : '<p class="wb-empty-state">当前没有待审核的队员申请。</p>'}</section>
    `
        : ""
    }${section === "accounts" ? `<section class="wb-panel wb-accounts admin-account-panel" id="accounts"><header class="wb-panel-head"><h2>账号列表</h2><p>启停 · 解绑 · 删除</p></header><div class="wb-account-tools"><p>最多显示最近 200 个账号；当前 ${users.length} 个。</p><div hidden data-account-tools><label>筛选当前账号列表<input type="search" data-account-query placeholder="用户名、身份、档案或状态" aria-describedby="account-search-help"></label><p id="account-search-help">仅筛选本页账号；支持管理员、队员、普通用户、正常、已禁用。</p><p data-account-count role="status"></p></div></div><div class="table-wrap"><table class="wb-account-table"><thead><tr><th>用户名</th><th>身份</th><th>队员档案</th><th>状态</th><th>操作</th></tr></thead><tbody>${userRows || '<tr><td colspan="5">当前没有可显示的账号。</td></tr>'}</tbody></table></div></section>` : ""}
    </div>`,
    true,
    true,
  );
}
