import type { JoinReview, ManagedUser, PendingCounts } from "../routes/admin";
import { escapeHtml, layout } from "../views";

export function adminDashboardPage(
  requests: JoinReview[],
  users: ManagedUser[],
  counts: PendingCounts,
  currentAdminId: number,
  csrf: string,
  message: string,
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
          ) => `<article class="card review-card"><h3>${escapeHtml(request.username)} · ${request.apply_type === "bind" ? "绑定档案" : "新建档案"}</h3>
    <p>目标：${escapeHtml(request.member_name || request.name)}</p><p>核对信息：${escapeHtml(request.identity_note)}</p>
    ${request.apply_type === "new" ? `<p>届别：${escapeHtml(request.cohort || request.join_year || "未填写")}</p><p>${escapeHtml(request.bio)}</p>` : ""}
    <div class="admin-actions"><form method="post" action="/admin/requests/${request.id}/approve"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>通过</button></form>
    <form method="post" action="/admin/requests/${request.id}/reject"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input name="admin_note" maxlength="1000" placeholder="驳回理由" required><button class="secondary">驳回</button></form></div></article>`,
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
      return `<tr><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.member_name || "—")}</td><td>${escapeHtml(user.status)}</td><td><div class="account-actions"><form method="post" action="/admin/users/${user.id}/toggle"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="small secondary">${user.status === "active" ? "禁用" : "启用"}</button></form>${unlink}${remove}</div></td></tr>`;
    })
    .join("");
  const badge = (count: number) => (count ? `<strong class="count-badge">${count}</strong>` : "");
  return layout(
    "管理员",
    `<section class="page-heading admin-heading"><p class="eyebrow">ADMIN</p><h1>管理员工作台</h1><p>先处理待办，再管理剧团内容和网站设置。</p>${notices[message] ? `<p class="notice">${notices[message]}</p>` : ""}</section>
    <section class="admin-command-groups" aria-label="管理功能">
      <article class="admin-command-group urgent"><p class="eyebrow">TO DO</p><h2>待处理</h2><nav><a href="#member-requests"><span aria-hidden="true">👤</span><span>队员认证</span>${badge(counts.member_requests)}</a><a href="/admin/production-requests"><span aria-hidden="true">🎭</span><span>作品加入</span>${badge(counts.production_joins)}</a><a href="/admin/resources/reviews"><span aria-hidden="true">📁</span><span>资料审核</span>${badge(counts.resource_reviews)}</a><a href="/admin/suggestions"><span aria-hidden="true">＋</span><span>建档申请</span>${badge(counts.production_creates)}</a><a href="/admin/suggestions"><span aria-hidden="true">✦</span><span>网站建议</span>${badge(counts.website_suggestions)}</a></nav></article>
      <article class="admin-command-group"><p class="eyebrow">CONTENT</p><h2>内容管理</h2><nav><a href="/productions"><span aria-hidden="true">🎭</span><span>作品与演职员</span></a><a href="/admin/productions/new"><span aria-hidden="true">＋</span><span>创建作品</span></a><a href="/members"><span aria-hidden="true">👥</span><span>队员名录</span></a><a href="/admin/members/new"><span aria-hidden="true">＋</span><span>新建队员档案</span></a><a href="/admin/resources"><span aria-hidden="true">📁</span><span>资料管理</span></a><a href="/announcements"><span aria-hidden="true">📣</span><span>公告管理</span></a></nav></article>
      <article class="admin-command-group"><p class="eyebrow">WEBSITE</p><h2>网站设置</h2><nav><a href="/admin/review-history"><span aria-hidden="true">✓</span><span>审核历史</span></a><a href="/admin/system"><span aria-hidden="true">▤</span><span>存储与服务状态</span></a><a href="/admin/site"><span aria-hidden="true">⚙</span><span>页面与剧团信息</span></a><a href="/help"><span aria-hidden="true">?</span><span>管理员指南</span></a></nav></article>
    </section>
    <section id="member-requests" class="admin-section"><div class="section-heading"><div><p class="eyebrow">MEMBER REQUESTS</p><h2>待审核队员申请</h2></div>${badge(counts.member_requests)}</div><div class="review-grid">${requestRows}</div></section><section class="admin-section"><div class="section-heading"><div><p class="eyebrow">ACCOUNTS</p><h2>账号管理</h2></div></div><div class="table-wrap"><table><thead><tr><th>用户名</th><th>身份</th><th>队员档案</th><th>状态</th><th>操作</th></tr></thead><tbody>${userRows}</tbody></table></div></section>`,
    true,
    true,
  );
}
