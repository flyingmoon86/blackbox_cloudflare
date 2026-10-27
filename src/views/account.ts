import { escapeHtml, message } from "./html";
import { layout } from "./layout";
import { tryGetContext } from "hono/context-storage";
import { adminPortal } from "../services/admin-portal";
import { turnstileWidget } from "../services/turnstile";
import type { AppEnv, UserSession } from "../types";
export function loginPage(csrf: string, error = "", next = "/", info = ""): string {
  const context = tryGetContext<AppEnv>();
  const portal = context ? adminPortal(context)?.active : false;
  return layout(
    "登录",
    `<section class="auth-stage"><section class="card auth ticket-login"><p class="eyebrow">ADMIT ONE · BLACK BOX${portal ? " · ADMIN" : ""}</p><h1>${portal ? "后台登录" : "检票入场"}</h1><p class="muted">${portal ? "使用现有管理员账号登录。登录状态最长保留 14 天；共用设备使用后请退出。" : "黑匣子话剧队 · 欢迎回到舞台"}</p>
  ${message(info, "notice")}${message(error)}<form method="post" action="/login"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
  <label>用户名<input name="username" autocomplete="username" maxlength="50" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">登录</button></form>${portal ? "" : '<p><a href="/register">还没有账号？注册</a></p>'}</section></section>`,
  );
}

export function registerPage(csrf: string, error = "", values: { username?: string; email?: string } = {}): string {
  return layout(
    "注册",
    `<section class="auth-stage"><section class="card auth"><p class="eyebrow">JOIN US</p><h1>创建账号</h1><p class="muted">先注册普通账号，之后可以在个人中心申请队员认证。</p>${message(error)}
  <form method="post" action="/register"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>用户名<input name="username" autocomplete="username" maxlength="50" value="${escapeHtml(values.username)}" required></label>
  <label>邮箱（可稍后填写）<input name="email" type="email" autocomplete="email" maxlength="254" value="${escapeHtml(values.email)}"><span class="hint">邮件服务接入后，验证邮箱可用于找回密码。</span></label>
  <label>密码<input name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入密码<input name="confirm_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  ${turnstileWidget("signup")}<button type="submit">注册</button></form><p><a href="/login">已有账号？返回登录</a></p></section></section>`,
  );
}

export function registerDonePage(username: string, hasEmail: boolean): string {
  const emailText = hasEmail
    ? "邮箱已保存为待验证，邮件功能接入后可在个人中心完成验证。"
    : "你可以稍后在个人中心添加邮箱。";
  return layout(
    "注册成功",
    `<section class="card auth"><p class="eyebrow">WELCOME</p><h1>账号已创建</h1><p>${escapeHtml(username)}，${emailText}</p><h2>你是话剧队队员吗？</h2><p>登录后可以申请队员认证：先选择自己的已有档案，找不到时再申请新建。审核通过后，可修改个人信息、登记作品角色和分工。</p><p><a class="button" href="/login?next=%2Fprofile%2Fmember-application">登录并认证队员</a></p><a href="/login">先登录，暂不认证</a></section>`,
  );
}

export function certificationPromptPage(next: string): string {
  return layout(
    "登录成功",
    `<section class="auth-stage"><section class="card auth"><p class="eyebrow">WELCOME BACK</p><h1>登录成功</h1><h2>你是话剧队队员吗？</h2><p>认证后可以修改自己的队员信息、申请加入作品，登记角色或后台分工。</p><p>先在已有档案中找到自己；找不到时再申请新建。认证需要管理员审核。</p><p><a class="button" href="/profile/member-application">去认证队员</a></p><p><a class="button secondary" href="${escapeHtml(next)}">暂时跳过，继续访问</a></p><p class="hint">普通账号也可以浏览和提交资料。稍后可从个人中心申请认证。</p></section></section>`,
    true,
  );
}

export function profilePage(
  user: UserSession,
  csrf: string,
  error = "",
  request: {
    id: number;
    apply_type: string;
    name: string;
    status: string;
    admin_note: string;
    result_acknowledged: number;
  } | null = null,
): string {
  const email = user.email
    ? `已验证邮箱：${escapeHtml(user.email)}`
    : user.pending_email
      ? `待验证邮箱：${escapeHtml(user.pending_email)}`
      : "尚未填写邮箱";
  const application =
    user.role === "user"
      ? '<p><a class="button secondary" href="/profile/member-application">申请认证为队员</a></p>'
      : "";
  const result =
    request && request.status !== "pending" && !request.result_acknowledged
      ? `<aside class="${request.status === "approved" ? "notice" : "alert"}"><strong>${request.status === "approved" ? "队员申请已通过" : "队员申请已驳回"}</strong><p>${request.status === "rejected" ? escapeHtml(request.admin_note || "请联系管理员了解原因。") : "你的账号权限已经更新。"}</p><form method="post" action="/profile/requests/${request.id}/acknowledge"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="small secondary">我知道了</button></form></aside>`
      : "";
  return layout(
    "个人中心",
    `${user.must_change_password ? '<aside class="notice" role="alert"><strong>首次登录，请先修改临时密码</strong><p>完成修改并重新登录后，才能使用管理功能。</p></aside>' : ""}${result}<section class="two-column"><article class="card"><h1>个人中心</h1><p>用户名：${escapeHtml(user.username)}</p><p>身份：${escapeHtml({ admin: "管理员", member: "认证队员", user: "普通账号" }[user.role])}</p><p>${email}</p>${application}</article>
  <article class="card"><h2>我的资料</h2>${user.role === "member" && user.member_id ? `<p><a href="/profile/member">修改我的信息</a></p><p><a href="/profile/members/${user.member_id}/photos">我的精选照片</a></p><p><a href="/graduation/${user.member_id}">我的毕业去向（私密）</a></p>` : ""}<h2>修改密码</h2>${message(error)}<form method="post" action="/profile/password"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>当前密码<input type="password" name="current_password" autocomplete="current-password" required></label>
  <label>新密码<input type="password" name="new_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入新密码<input type="password" name="confirm_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <button type="submit">保存新密码</button></form><form class="form-sep" method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">退出登录</button></form></article></section>`,
    true,
    user.role === "admin",
  );
}
