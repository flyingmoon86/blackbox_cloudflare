import { YEARS, yearSelect, icon, pagination, type PageInfo } from "./views/shared";
import { assetUrl } from "./views/assets";
import type { UserSession } from "./types";
import type { MemberRow } from "./routes/members";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function layout(title: string, content: string, signedIn = false, admin = false, themeId?: number): string {
  const link = (href: string, label: string) =>
    '<a href="' +
    href +
    '">' +
    (href === "/"
      ? icon("home")
      : href === "/productions"
        ? icon("productions")
        : href === "/resources"
          ? icon("resources")
          : href === "/members"
            ? icon("members")
            : href === "/help"
              ? icon("help")
              : href === "/thanks"
                ? icon("thanks")
                : "") +
    label +
    "</a>";
  const menu = (label: string, items: string) =>
    '<details class="nav-menu"><summary>' +
    (label === "作品与资料"
      ? icon("productions")
      : label === "队员与剧团"
        ? icon("members")
        : label === "指南与鸣谢"
          ? icon("help")
          : "") +
    label +
    '</summary><div class="nav-panel">' +
    items +
    "</div></details>";
  const group = (caption: string, href: string, label: string, children: string) =>
    '<section class="nav-group"><p class="nav-caption">' +
    caption +
    "</p><h2>" +
    link(href, label) +
    '</h2><ul class="nav-children">' +
    children +
    "</ul></section>";
  const child = (href: string, label: string) => "<li>" + link(href, label) + "</li>";
  const nav =
    link("/", "首页") +
    menu(
      "作品与资料",
      group(
        "走进舞台",
        "/productions",
        "作品档案",
        child("/suggestions?type=production&source=productions", "申请创建作品"),
      ) +
        group(
          "留存每一幕",
          "/resources",
          "资料库",
          child("/resources/submit", "我要补充资料") + (signedIn ? child("/my-resources", "我的提交") : ""),
        ),
    ) +
    menu(
      "队员与剧团",
      group(
        "台前与幕后",
        "/members",
        "队员名录",
        child("/profile/member", "修改我的信息") + child("/profile/member-application", "申请队员认证"),
      ) + group("认识我们", "/#about", "剧团介绍", child("/#contact", "联系我们")),
    ) +
    menu(
      "指南与鸣谢",
      group("从这里开始", "/help", "网站使用指南", admin ? child("/help#captain-guide", "管理员指南") : "") +
        group("一起完善黑匣子", "/thanks", "网站贡献者", child("/feedback", "提交网站建议")),
    ) +
    (admin ? link("/admin", "管理") : "");
  const account =
    '<a class="account-link" href="' +
    (signedIn ? "/profile" : "/login") +
    '" aria-label="' +
    (signedIn ? "个人中心" : "登录或注册") +
    '" title="' +
    (signedIn ? "个人中心" : "登录或注册") +
    '"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20v-1.5a6.5 6.5 0 0 1 13 0V20"/><circle cx="12" cy="12" r="10"/></svg></a>';
  const mobile =
    '<nav class="mobile-nav" aria-label="手机主导航">' +
    link("/", "首页") +
    link("/productions", "作品资料") +
    link("/members", "队员") +
    link(signedIn ? "/profile" : "/login", signedIn ? "我的" : "登录") +
    "</nav>";
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escapeHtml(title) +
    ' · 黑匣子</title><link rel="stylesheet" href="' +
    assetUrl("/app.css") +
    '"><link rel="stylesheet" href="' +
    assetUrl("/experience.css") +
    '"><link id="site-theme" rel="stylesheet" href="/site/theme.css' +
    (themeId ? "?production=" + themeId : "") +
    '"><script src="' +
    assetUrl("/app.js") +
    '" defer></script><script src="' +
    assetUrl("/experience.js") +
    '" defer></script></head><body class="' +
    (signedIn ? "signed-in" : "signed-out") +
    (content.includes('class="section-tabs"') ? " archive-page" : "") +
    '"><a class="skip-link" href="#main-content">跳到内容</a><header class="top"><a href="/" class="brand">黑匣子<span>BLACK BOX THEATRE</span></a><button class="menu-toggle" aria-expanded="false" aria-controls="main-navigation">菜单 ＋</button><nav id="main-navigation" class="desktop-nav" aria-label="主导航">' +
    nav +
    "</nav>" +
    account +
    (admin ? '<div class="admin-notification-host" data-admin-notifications aria-live="polite"></div>' : "") +
    '</header><div class="nav-scrim" aria-hidden="true"></div><main id="main-content" tabindex="-1">' +
    content +
    "</main>" +
    mobile +
    "</body></html>"
  );
}

function message(text: string, kind = "alert"): string {
  return text ? `<p class="${kind}" role="status">${escapeHtml(text)}</p>` : "";
}

export function loginPage(csrf: string, error = "", next = "/", info = ""): string {
  return layout(
    "登录",
    `<section class="auth-stage"><section class="card auth"><p class="eyebrow">BLACK BOX</p><h1>欢迎回来</h1><p class="muted">欢迎浏览剧团档案。登录后可以提交资料、申请作品和下载原文件。</p>
  ${message(info, "notice")}${message(error)}<form method="post" action="/login"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
  <label>用户名<input name="username" autocomplete="username" maxlength="50" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>
  <button type="submit">登录</button></form><p><a href="/register">还没有账号？注册</a></p></section></section>`,
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
  <button type="submit">注册</button></form><p><a href="/login">已有账号？返回登录</a></p></section></section>`,
  );
}

export function registerDonePage(username: string, hasEmail: boolean): string {
  const emailText = hasEmail
    ? "邮箱已保存为待验证，邮件功能接入后可在个人中心完成验证。"
    : "你可以稍后在个人中心添加邮箱。";
  return layout(
    "注册成功",
    `<section class="card auth"><p class="eyebrow">WELCOME</p><h1>账号已创建</h1><p>${escapeHtml(username)}，${emailText}</p><a class="button" href="/login">现在登录</a></section>`,
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
    `${result}<section class="two-column"><article class="card"><p class="eyebrow">ACCOUNT</p><h1>个人中心</h1><p>用户名：${escapeHtml(user.username)}</p><p>身份：${escapeHtml(user.role)}</p><p>${email}</p>${application}</article>
  <article class="card"><h2>账号管理</h2>${user.role === "member" && user.member_id ? '<p><a href="/profile/member">修改我的信息</a></p>' : ""}<h2>修改密码</h2>${message(error)}<form method="post" action="/profile/password"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
  <label>当前密码<input type="password" name="current_password" autocomplete="current-password" required></label>
  <label>新密码<input type="password" name="new_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <label>再次输入新密码<input type="password" name="confirm_password" minlength="8" maxlength="128" autocomplete="new-password" required></label>
  <button type="submit">保存新密码</button></form><hr><form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary" type="submit">退出登录</button></form></article></section>`,
    true,
    user.role === "admin",
  );
}

export function memberListPage(
  members: MemberRow[],
  years: number[],
  search: string,
  selectedYear: number | null,
  admin: boolean,
  signedIn = true,
  page?: PageInfo,
): string {
  const cards = members.length
    ? members
        .map((member) => {
          const portrait = member.photo
            ? `<img class="member-card-media" src="/members/${member.id}/avatar" alt="${escapeHtml(member.name)}的头像">`
            : `<span class="member-card-art" aria-hidden="true">${escapeHtml(member.name.slice(0, 1) || "剧")}</span>`;
          return `<article class="member-card${member.photo ? "" : " member-card-empty"}"><a class="member-card-link" href="/members/${member.id}">${portrait}<span class="member-card-shade"></span><span class="member-card-copy"><span class="eyebrow">${escapeHtml(cohortLabel(member.cohort) || (member.join_year ? member.join_year + " 年入队" : "剧团成员"))}</span><strong>${escapeHtml(member.name)}</strong>${member.contributor ? '<span class="contributor-tag">网站贡献者</span>' : ""}<span class="member-card-details"><span>${escapeHtml(member.bio || "点击查看队员档案与舞台经历")}</span><small>🌸 ${member.flower_count} · 查看档案 →</small></span></span></a></article>`;
        })
        .join("")
    : '<p class="card">没有找到符合条件的队员。</p>';
  const options = YEARS.map(
    (year) => `<option value="${year}"${selectedYear === year ? " selected" : ""}>${year}</option>`,
  ).join("");
  return layout(
    "队员名录",
    `<section class="page-heading"><p class="eyebrow">HALL OF FAME</p><h1>队员名录</h1>${admin ? '<p><a class="button" href="/admin/members/new">＋ 新建队员档案</a></p>' : ""}<form method="get" class="filters"><input name="q" value="${escapeHtml(search)}" placeholder="搜索姓名、入学年级或作品"><select name="year"><option value="">全部年份</option>${options}</select><button>查找</button></form></section><section class="card-grid" data-server-paged>${cards}</section>${pagination(page)}`,
    signedIn,
    admin,
  );
}

export function memberCreatePage(csrf: string, error = ""): string {
  return layout(
    "新建队员档案",
    `<section class="card auth"><p class="eyebrow">NEW MEMBER</p><h1>新建队员档案</h1>${message(error)}<p class="muted">先建立没有账号的历史或现役队员档案。队员注册后，可以申请绑定到这份档案。</p><form method="post" action="/admin/members/new"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>姓名<input name="name" maxlength="50" required></label><label>入队年份${yearSelect("join_year", "")}</label><label>入学年级${yearSelect("cohort", "")}<span class="hint">填写入校年份，显示为 2024 级。</span></label><label>个人简介<textarea name="bio" maxlength="5000" rows="7"></textarea></label><button>建立档案</button></form><p><a href="/members">返回队员名录</a></p></section>`,
    true,
    true,
  );
}

export function memberDetailPage(
  member: MemberRow,
  csrf: string,
  flower: string,
  own = false,
  admin = false,
  signedIn = true,
): string {
  const notice =
    flower === "sent"
      ? message("今天的花已送达。", "notice")
      : flower === "already"
        ? message("你今天已经送过花了，明天再来吧。")
        : "";
  const edit = admin
    ? `<a class="edit-link" href="/admin/members/${member.id}/edit">编辑队员档案</a>`
    : own
      ? '<a class="edit-link" href="/profile/member">修改我的信息</a>'
      : "";
  return layout(
    member.name,
    `<article class="card profile-detail">${member.photo ? `<img class="avatar avatar-large" src="/members/${member.id}/avatar" alt="${escapeHtml(member.name)}的头像">` : ""}<p class="eyebrow">${escapeHtml(cohortLabel(member.cohort) || "剧团成员")}</p><h1>${escapeHtml(member.name)}</h1>${member.contributor ? '<span class="contributor-tag">网站贡献者</span>' : ""}<p>${member.join_year ? member.join_year + " 年入队" : "入队年份待补充"}</p>${edit}${notice}<p>${escapeHtml(member.bio || "暂无简介")}</p><h2>参与作品</h2>${member.productions?.length ? `<ul>${member.productions.map((p) => `<li><a href="/productions/${p.id}">${escapeHtml(p.title)}</a></li>`).join("")}</ul>` : "<p>暂无已关联作品。</p>"}<p>收到 ${member.flower_count} 朵花</p><form method="post" action="/members/${member.id}/flowers"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>送一朵花</button></form><p><a href="/members">返回队员名录</a></p></article>`,
    signedIn,
    admin,
  );
}

export function memberEditPage(member: MemberRow, csrf: string, admin: boolean, saved: boolean): string {
  const action = admin ? `/admin/members/${member.id}/edit` : "/profile/member";
  const identity = admin
    ? `<label>姓名<input name="name" maxlength="50" value="${escapeHtml(member.name)}" required></label><label>入队年份${yearSelect("join_year", member.join_year)}</label><label>入学年级${yearSelect("cohort", member.cohort)}</label>`
    : `<p class="muted">姓名需要修改时请联系管理员。</p><label>入队年份${yearSelect("join_year", member.join_year)}</label><label>入学年级${yearSelect("cohort", member.cohort)}<span class="hint">填入校年份，非毕业年份；留空保留原记录。</span></label>`;
  const avatarForm = admin
    ? member.photo
      ? `<form method="post" action="/admin/members/${member.id}/avatar/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">移除当前头像</button></form>`
      : '<p class="muted">该队员尚未上传头像。</p>'
    : `<form method="post" action="/profile/member/avatar" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>更换头像<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/avif" required></label><span class="hint">支持 JPG、PNG、WebP、AVIF，最大 15MB。</span><button class="secondary">上传头像</button></form>`;
  return layout(
    admin ? "编辑队员档案" : "修改我的信息",
    `<section class="card auth"><p class="eyebrow">MEMBER PROFILE</p><h1>${admin ? "编辑队员档案" : "修改我的信息"}</h1>${saved ? `<p class="notice">${admin ? "队员档案" : "个人信息"}已保存。</p>` : ""}${member.photo ? `<img class="avatar avatar-large" src="/members/${member.id}/avatar" alt="当前头像">` : ""}<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${identity}<label>个人简介<textarea name="bio" maxlength="5000" rows="7">${escapeHtml(member.bio)}</textarea></label><p class="hint">参与作品会根据已审核的演职员关系自动展示，无需重复填写。</p><button>${admin ? "保存档案" : "保存信息"}</button></form><hr>${avatarForm}<p><a href="/members/${member.id}">返回队员档案</a></p></section>`,
    true,
    admin,
  );
}

export function memberApplicationPage(
  csrf: string,
  mode: "bind" | "new",
  members: Array<{ id: number; name: string; cohort: string; join_year?: number | null }>,
  pending: unknown,
): string {
  if (pending)
    return layout(
      "队员认证",
      '<section class="card auth"><h1>申请等待审核</h1><p>管理员审核后，结果会显示在个人中心。暂时不需要重复提交。</p><a href="/profile">返回个人中心</a></section>',
      true,
    );
  const switcher =
    mode === "bind"
      ? "<p>先在已有队员档案中找到自己，再提交认证。</p>"
      : '<p>确认没有自己的档案后，再填写以下信息。<a href="?type=bind">返回查找已有档案</a></p>';
  const common = `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="apply_type" value="${mode}"><label>一句台词或参与经历<textarea name="identity_note" maxlength="1000" rows="4" required></textarea><span class="hint">也可以填写后台分工或排练经历，仅管理员可见。</span></label>`;
  const grouped = new Map<number, typeof members>();
  for (const member of members) {
    const year = /^\d{4}$/.test(member.cohort) ? Number(member.cohort) : member.join_year || 0;
    grouped.set(year, [...(grouped.get(year) || []), member]);
  }
  const choices = [...grouped]
    .sort(([a], [b]) => b - a)
    .map(
      ([year, rows]) =>
        `<optgroup label="${year ? year + " 年" : "年份待补充"}">${rows.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? "（" + escapeHtml(member.cohort) + "级）" : ""}</option>`).join("")}</optgroup>`,
    )
    .join("");
  const fields =
    mode === "bind"
      ? `<label>选择我的档案<select name="member_id" required><option value="">请选择</option>${choices}</select><span class="hint">按入学年份从新到旧排列，未填年级时使用入队年份。</span></label>`
      : `<label>姓名<input name="name" maxlength="50" required></label><label>入队年份${yearSelect("join_year", "")}</label><label>入学年级${yearSelect("cohort", "")}</label><label>简介<textarea name="bio" rows="4"></textarea></label>`;
  return layout(
    "队员认证",
    `<section class="card auth"><p class="eyebrow">MEMBER APPLICATION</p><h1>申请队员认证</h1>${switcher}<form method="post" action="/profile/member-application">${fields}${common}<button>提交申请</button></form>${mode === "bind" ? '<p><a href="?type=new">找不到我的档案，申请新建</a></p>' : ""}</section>`,
    true,
  );
}

export function cohortLabel(value: string): string {
  const v = String(value || "").trim();
  return /^[0-9]{4}$/.test(v) ? v + " 级" : v.includes("届") ? "入学年级待确认" : v;
}
