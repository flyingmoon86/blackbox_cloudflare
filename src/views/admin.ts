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
  const pendingTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const badge = (count: number) => (count ? `<strong class="count-badge">${count}</strong>` : "");
  return layout(
    "管理员",
    `<section class="page-heading admin-heading"><p class="eyebrow">ADMIN</p><h1>管理员工作台</h1><p>处理申请与审核，或直接填写资料。</p>${notices[message] ? `<p class="notice">${notices[message]}</p>` : ""}</section>
    <aside class="dashboard-task-alert" data-pending-alert role="status"${pendingTotal ? "" : " hidden"}><strong data-pending-message>有 ${pendingTotal} 项任务等待处理</strong><a data-pending-link href="#dashboard-pending-title">立即查看 →</a></aside>
    <section class="dashboard-pending" aria-labelledby="dashboard-pending-title"><h2 id="dashboard-pending-title">待处理</h2><nav aria-label="待处理事项"><a href="#member-requests">队员认证 ${badge(counts.member_requests)}</a><a href="/admin/production-requests">作品加入 ${badge(counts.production_joins)}</a><a href="/admin/resources/reviews">资料审核 ${badge(counts.resource_reviews)}</a><a href="/admin/suggestions">建档申请 ${badge(counts.production_creates)}</a><a href="/admin/community">网站建议 ${badge(counts.website_suggestions)}</a></nav>
    <details id="member-requests" class="dashboard-member-requests"${counts.member_requests ? " open" : ""}><summary>待审核队员申请 · ${counts.member_requests} 项</summary>${counts.member_requests ? reviewQueue("member", requestRows) : requestRows}</details>
    <details class="dashboard-more"><summary>账号与处理记录</summary><nav aria-label="处理记录"><a href="/admin/credit-imports">查看导入记录</a><a href="/admin/review-history">查看审核记录</a><a href="/admin/suggestions">处理历史建档与网站建议</a><a href="/admin/system">检查存储与服务</a></nav><details class="admin-account-panel" id="accounts"><summary>账号管理 · ${users.length} 个账号</summary><div class="table-wrap"><table><thead><tr><th>用户名</th><th>身份</th><th>队员档案</th><th>状态</th><th>操作</th></tr></thead><tbody>${userRows}</tbody></table></div></details></details></section>
    <section class="dashboard-fill" aria-labelledby="dashboard-fill-title"><h2 id="dashboard-fill-title">填资料</h2><nav class="dashboard-tools" aria-label="资料填写"><a href="/admin/productions/new"><strong>创建作品</strong><span>填写作品信息与演出版本</span></a><a href="/admin/members/new"><strong>新建队员档案</strong><span>补充队员的基本资料</span></a><a href="/admin/credit-imports/new"><strong>表格导入演职人员</strong><span>选择作品，上传并核对名单</span></a><a href="/resources/submit"><strong>上传资料</strong><span>提交剧照、剧本等作品资料</span></a><a href="/admin/announcements/new"><strong>发布公告</strong><span>填写公告标题与正文</span></a><a href="/admin/site"><strong>编辑网站页面</strong><span>修改首页、指南和鸣谢内容</span></a></nav></section>`,
    true,
    true,
  );
}
