import type { JoinReview, ManagedUser } from "../routes/admin";
import { escapeHtml, layout } from "../views";

export function adminDashboardPage(requests: JoinReview[], users: ManagedUser[], csrf: string, message: string): string {
  const notices: Record<string, string> = { approved: "申请已通过。", rejected: "申请已驳回。", "user-updated": "账号状态已更新。" };
  const requestRows = requests.length ? requests.map((request) => `<article class="card review-card"><h3>${escapeHtml(request.username)} · ${request.apply_type === "bind" ? "绑定档案" : "新建档案"}</h3>
    <p>目标：${escapeHtml(request.member_name || request.name)}</p><p>核对信息：${escapeHtml(request.identity_note)}</p>
    ${request.apply_type === "new" ? `<p>届别：${escapeHtml(request.cohort || request.join_year || "未填写")}</p><p>${escapeHtml(request.bio)}</p>` : ""}
    <div class="admin-actions"><form method="post" action="/admin/requests/${request.id}/approve"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>通过</button></form>
    <form method="post" action="/admin/requests/${request.id}/reject"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input name="admin_note" maxlength="1000" placeholder="驳回理由" required><button class="secondary">驳回</button></form></div></article>`).join("") : '<p class="card">当前没有待审核的队员申请。</p>';
  const userRows = users.map((user) => `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.member_name || "—")}</td><td>${escapeHtml(user.status)}</td><td><form method="post" action="/admin/users/${user.id}/toggle"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="small secondary">${user.status === "active" ? "禁用" : "启用"}</button></form></td></tr>`).join("");
  return layout("管理员", `<section class="page-heading"><p class="eyebrow">ADMIN</p><h1>管理员工作台</h1><p><a href="/productions">管理作品与演职员</a> · <a href="/admin/productions/new">创建作品</a></p>${notices[message] ? `<p class="notice">${notices[message]}</p>` : ""}</section>
    <section><h2>待审核申请</h2><div class="review-grid">${requestRows}</div></section><section><h2>账号管理</h2><div class="table-wrap"><table><thead><tr><th>用户名</th><th>身份</th><th>队员档案</th><th>状态</th><th>操作</th></tr></thead><tbody>${userRows}</tbody></table></div></section>`, true);
}
