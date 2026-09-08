import type { UserSession } from "./types";
import type { MemberRow } from "./routes/members";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function layout(title: string, content: string, signedIn = false): string {
  const nav = signedIn
    ? '<a href="/">首页</a><a href="/members">队员名录</a><a href="/profile">个人中心</a>'
    : '<a href="/">首页</a><a href="/login">登录</a><a href="/register">注册</a>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · 黑匣子</title><link rel="stylesheet" href="/app.css"></head>
  <body><header class="top"><a href="/" class="brand">黑匣子</a><nav>${nav}</nav></header><main>${content}</main></body></html>`;
}

function message(text: string, kind = "alert"): string {
  return text ? `<p class="${kind}" role="status">${escapeHtml(text)}</p>` : "";
}

export function loginPage(csrf: string, error = "", next = "/", info = ""): string {
  return layout("登录", `<section class="card auth"><p class="eyebrow">BLACK BOX</p><h1>欢迎回家</h1><p class="muted">登录后查看剧团公告、作品与内部资料。</p>
  ${message(info, "notice")}${message(error)}<form method="post" action="/login"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
  <label>用户名<input name="username" autocomplete="username" maxlength="50" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">登录</button></form><p><a href="/register">还没有账号？注册</a></p></section>`);
}

export function registerPage(csrf: string, error = "", values: { username?: string; email?: string } = {}): string {
  return layout("注册", `<section class="card auth"><p class="eyebrow">JOIN US</p><h1>创建账号</h1>${message(error)}
  <form method="post" action="/register"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>用户名<input name="username" autocomplete="username" maxlength="50" value="${escapeHtml(values.username)}" required></label>
  <label>邮箱（可稍后填写）<input name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(values.email)}"><span class="hint">邮件服务接入后，验证邮箱可用于找回密码。</span></label>
  <label>密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入密码<input name="confirm_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <button type="submit">注册</button></form></section>`);
}

export function registerDonePage(username: string, hasEmail: boolean): string {
  const emailText = hasEmail ? "邮箱已保存为待验证，邮件功能接入后可在个人中心完成验证。" : "你可以稍后在个人中心添加邮箱。";
  return layout("注册成功", `<section class="card auth"><p class="eyebrow">WELCOME</p><h1>账号已创建</h1><p>${escapeHtml(username)}，${emailText}</p><a class="button" href="/login">现在登录</a></section>`);
}

export function publicHome(): string {
  return layout("首页", `<section class="hero"><div><p class="eyebrow">BLACK BOX THEATRE</p><h1>黑匣子永远是你的家</h1><p>保存每一次排练、演出与相遇。</p><a class="button" href="/login">登录查看剧团档案</a></div></section>
  <section class="two-column"><article class="card"><h2>关于我们</h2><p>这里记录话剧队共同创作的作品和故事。</p></article><article class="card"><h2>联系我们</h2><p><a href="mailto:moonflying56@gmail.com">moonflying56@gmail.com</a></p></article></section>`);
}

export function memberHome(user: UserSession, csrf: string): string {
  return layout("队员首页", `<section class="card"><p class="eyebrow">${escapeHtml(user.role)}</p><h1>${escapeHtml(user.username)}，欢迎回来</h1>
  <p>账号基础功能已接通 D1。作品、资源和后台将在后续阶段逐项迁移。</p><p><a href="/profile">进入个人中心</a></p>
  <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">退出登录</button></form></section>`, true);
}

export function profilePage(user: UserSession, csrf: string, error = ""): string {
  const email = user.email ? `已验证邮箱：${escapeHtml(user.email)}` : user.pending_email ? `待验证邮箱：${escapeHtml(user.pending_email)}` : "尚未填写邮箱";
  const application = user.role === "user" ? '<p><a class="button secondary" href="/profile/member-application">申请认证为队员</a></p>' : "";
  return layout("个人中心", `<section class="two-column"><article class="card"><p class="eyebrow">ACCOUNT</p><h1>个人中心</h1><p>用户名：${escapeHtml(user.username)}</p><p>身份：${escapeHtml(user.role)}</p><p>${email}</p>${application}</article>
  <article class="card"><h2>修改密码</h2>${message(error)}<form method="post" action="/profile/password"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>当前密码<input type="password" name="current_password" autocomplete="current-password" required></label>
  <label>新密码<input type="password" name="new_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入新密码<input type="password" name="confirm_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <button type="submit">保存新密码</button></form></article></section>`, true);
}

export function memberListPage(members: MemberRow[], years: number[], search: string, selectedYear: number | null): string {
  const cards = members.length ? members.map((member) => `<article class="card member-card"><p class="eyebrow">${escapeHtml(member.cohort || member.join_year || "剧团成员")}</p><h2><a href="/members/${member.id}">${escapeHtml(member.name)}</a></h2><p>${escapeHtml(member.bio || "暂无简介")}</p><p class="muted">🌸 ${member.flower_count}</p></article>`).join("") : '<p class="card">没有找到符合条件的队员。</p>';
  const options = years.map((year) => `<option value="${year}"${selectedYear === year ? " selected" : ""}>${year}</option>`).join("");
  return layout("队员名录", `<section class="page-heading"><p class="eyebrow">HALL OF FAME</p><h1>队员名录</h1><form method="get" class="filters"><input name="q" value="${escapeHtml(search)}" placeholder="搜索姓名、届别或作品"><select name="year"><option value="">全部年份</option>${options}</select><button>查找</button></form></section><section class="card-grid">${cards}</section>`, true);
}

export function memberDetailPage(member: MemberRow, csrf: string, flower: string): string {
  const notice = flower === "sent" ? message("今天的花已送达。", "notice") : flower === "already" ? message("你今天已经送过花了，明天再来吧。") : "";
  return layout(member.name, `<article class="card profile-detail"><p class="eyebrow">${escapeHtml(member.cohort || member.join_year || "MEMBER")}</p><h1>${escapeHtml(member.name)}</h1>${notice}<p>${escapeHtml(member.bio || "暂无简介")}</p><h2>代表作</h2><p>${escapeHtml(member.works || "暂无记录")}</p><p>收到 ${member.flower_count} 朵花</p><form method="post" action="/members/${member.id}/flowers"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>送一朵花</button></form><p><a href="/members">返回队员名录</a></p></article>`, true);
}

export function memberApplicationPage(csrf: string, mode: "bind" | "new", members: Array<{ id: number; name: string; cohort: string }>, pending: unknown): string {
  if (pending) return layout("队员认证", '<section class="card auth"><h1>申请等待审核</h1><p>管理员审核后，结果会显示在个人中心。暂时不需要重复提交。</p><a href="/profile">返回个人中心</a></section>', true);
  const switcher = `<div class="choice-tabs"><a class="${mode === "bind" ? "active" : ""}" href="?type=bind">绑定已有档案</a><a class="${mode === "new" ? "active" : ""}" href="?type=new">申请新档案</a></div>`;
  const common = `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="apply_type" value="${mode}"><label>一句台词或参与经历<textarea name="identity_note" maxlength="1000" rows="4" required></textarea><span class="hint">也可以填写后台分工或排练经历，仅管理员可见。</span></label>`;
  const fields = mode === "bind" ? `<label>选择我的档案<select name="member_id" required><option value="">请选择</option>${members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? `（${escapeHtml(member.cohort)}）` : ""}</option>`).join("")}</select></label>` : '<label>姓名<input name="name" maxlength="50" required></label><label>入队年份<input name="join_year" type="number" min="1" max="9999"></label><label>届别<input name="cohort" maxlength="20" placeholder="如 2015 届"></label><label>简介<textarea name="bio" rows="4"></textarea></label>';
  return layout("队员认证", `<section class="card auth"><p class="eyebrow">MEMBER APPLICATION</p><h1>申请队员认证</h1>${switcher}<form method="post" action="/profile/member-application">${common}${fields}<button>提交申请</button></form></section>`, true);
}
