import type { UserSession } from "./types";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function layout(title: string, content: string, signedIn = false): string {
  const nav = signedIn
    ? '<a href="/">首页</a><a href="/profile">个人中心</a>'
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
  return layout("个人中心", `<section class="two-column"><article class="card"><p class="eyebrow">ACCOUNT</p><h1>个人中心</h1><p>用户名：${escapeHtml(user.username)}</p><p>身份：${escapeHtml(user.role)}</p><p>${email}</p></article>
  <article class="card"><h2>修改密码</h2>${message(error)}<form method="post" action="/profile/password"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>当前密码<input type="password" name="current_password" autocomplete="current-password" required></label>
  <label>新密码<input type="password" name="new_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入新密码<input type="password" name="confirm_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <button type="submit">保存新密码</button></form></article></section>`, true);
}
