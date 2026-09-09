import type { UserSession } from "./types";
import type { MemberRow } from "./routes/members";
import type { AnnouncementRow, SiteProfileRow } from "./routes/content";
import type { ProductionRow } from "./routes/productions";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function layout(title: string, content: string, signedIn = false, admin = false): string {
  const nav = signedIn
    ? `<a href="/">首页</a><a href="/productions">作品与资料</a><a href="/members">队员名录</a><a href="/profile">个人中心</a><a href="/help">网站使用指南</a>${admin ? '<a href="/admin">管理员工作台</a>' : ""}`
    : '<a href="/">首页</a><a href="/login">登录</a><a href="/register">注册</a>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · 黑匣子</title><link rel="stylesheet" href="/app.css"><script src="/app.js" defer></script></head>
  <body><header class="top"><a href="/" class="brand">黑匣子</a><nav>${nav}</nav></header><main>${content}</main></body></html>`;
}

function message(text: string, kind = "alert"): string {
  return text ? `<p class="${kind}" role="status">${escapeHtml(text)}</p>` : "";
}

export function loginPage(csrf: string, error = "", next = "/", info = ""): string {
  return layout(
    "登录",
    `<section class="auth-stage"><section class="card auth"><p class="eyebrow">BLACK BOX</p><h1>欢迎回来</h1><p class="muted">登录后查看剧团公告、作品与内部资料。</p>
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

function pageTexts(profile: SiteProfileRow): Record<string, string> {
  try {
    return JSON.parse(profile.page_texts || "{}");
  } catch {
    return {};
  }
}

function featuredProduction(featured: ProductionRow | null, signedIn: boolean): string {
  if (!featured) return "";
  const ratio = featured.cover_ratio === "portrait" ? "portrait" : "landscape";
  const mode = featured.feature_layout === "overlay" && featured.cover_id ? "overlay" : "split";
  const href = signedIn ? `/productions/${featured.id}` : `/login?next=/productions/${featured.id}`;
  const image = featured.cover_id
    ? `<img class="feature-cover" src="/site/featured-cover" alt="${escapeHtml(featured.title)}展示图">`
    : "";
  return `<section class="card feature feature-${mode} feature-ratio-${ratio}${image ? "" : " feature-without-cover"}">${image}<div class="feature-copy"><p class="eyebrow">${signedIn ? "精选大戏" : "即将演出"}</p><h2><a href="${href}">${escapeHtml(featured.title)}</a></h2><p>${escapeHtml(featured.promo || featured.synopsis || "演出信息即将公布。")}</p><a class="button" href="${href}">${signedIn ? "查看作品" : "登录后查看"}</a></div></section>`;
}

export function publicHome(profile: SiteProfileRow, featured: ProductionRow | null): string {
  const texts = pageTexts(profile);
  const notice =
    texts.test_notice ||
    "网站正在测试中。你可以浏览和试用功能；认证队员还可以通过首页意见箱提交建议。请勿上传敏感或无权分享的资料。";
  let noticeKey = 2166136261;
  for (const character of notice) noticeKey = Math.imul(noticeKey ^ character.charCodeAt(0), 16777619);
  const feature = featuredProduction(featured, false);
  const hero = profile.hero_photo
    ? ' style="background-image:linear-gradient(90deg,rgba(10,8,8,.94),rgba(10,8,8,.25)),url(/site/hero)"'
    : "";
  return layout(
    "首页",
    `<dialog class="test-notice" data-test-notice="${noticeKey >>> 0}"><form method="dialog"><p class="eyebrow">TEST NOTICE</p><h2>测试须知</h2><p class="preline">${escapeHtml(notice)}</p><button value="understood">我已明白</button></form></dialog><section class="hero"${hero}><div><p class="eyebrow">BLACK BOX THEATRE</p><h1>${escapeHtml(texts.visitor_welcome || "这里是黑匣子")}</h1><p>保存每一次排练、演出与相遇。</p><a class="button" href="/login">登录查看剧团档案</a></div></section>${feature}
  <section class="two-column"><article class="card"><h2>关于我们</h2><p>${escapeHtml(texts.about_text || profile.introduction || "这里记录话剧队共同创作的作品和故事。")}</p></article><article class="card"><h2>联系我们</h2><p>${escapeHtml(texts.contact_intro || "")}</p><p><a href="mailto:${escapeHtml(profile.contact_email || "moonflying56@gmail.com")}">${escapeHtml(profile.contact_email || "moonflying56@gmail.com")}</a></p></article></section>`,
  );
}

export function memberHome(
  user: UserSession,
  csrf: string,
  profile: SiteProfileRow,
  featured: ProductionRow | null,
  announcements: AnnouncementRow[],
): string {
  const texts = pageTexts(profile);
  const edit = user.role === "admin" ? '<a class="edit-link" href="/admin/site#home_welcome">编辑首页文案</a>' : "";
  const news = announcements.length
    ? announcements
        .map(
          (x) =>
            `<li><a href="/announcements/${x.id}">${escapeHtml(x.title)}</a> <span class="muted">${escapeHtml(x.created_at.slice(0, 10))}</span></li>`,
        )
        .join("")
    : "<li>暂无公告</li>";
  const hero = profile.hero_photo
    ? ' style="background-image:linear-gradient(90deg,rgba(10,8,8,.94),rgba(10,8,8,.25)),url(/site/hero)"'
    : "";
  const adminLink = user.role === "admin" ? '<li><a href="/admin">管理员工作台</a></li>' : "";
  const suggestionLink =
    user.role === "member" || user.role === "admin"
      ? '<p><a class="button secondary" href="/suggestions">提交网站建议</a></p>'
      : "";
  const welcome =
    user.role === "member" || user.role === "admin"
      ? texts.home_welcome || "黑匣子永远是你的家"
      : texts.visitor_welcome || "这里是黑匣子";
  return layout(
    "队员首页",
    `<section class="hero"${hero}><div><p class="eyebrow">${escapeHtml(user.role)}</p><h1>${escapeHtml(welcome)}</h1><p>${escapeHtml(user.username)}，欢迎回来。</p>${edit}</div></section>${featuredProduction(featured, true)}<section class="two-column"><article class="card"><h2>公告</h2><ul>${news}</ul><a href="/announcements">查看全部公告</a></article><article class="card"><h2>快捷入口</h2><ul class="link-list"><li><a href="/">首页</a></li><li><a href="/productions">作品与资料</a></li><li><a href="/members">队员名录</a></li><li><a href="/profile">个人中心</a></li>${adminLink}</ul></article></section><section class="two-column"><article class="card"><h2>招新</h2><p class="preline">${escapeHtml(profile.recruitment || "欢迎喜欢舞台的你加入我们。")}</p><p class="muted preline">${escapeHtml(profile.requirements || "关注剧团通知，了解本学期招新安排。")}</p></article><article class="card"><h2>关于我们</h2><p class="preline">${escapeHtml(texts.about_text || profile.introduction || "这里记录话剧队共同创作的作品和故事。")}</p><p><a href="mailto:${escapeHtml(profile.contact_email || "moonflying56@gmail.com")}">联系我们</a></p>${suggestionLink}</article></section>`,
    true,
    user.role === "admin",
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
  <article class="card"><h2>账号管理</h2>${user.role === "member" && user.member_id ? '<p><a href="/profile/member">维护我的队员档案</a></p>' : ""}<h2>修改密码</h2>${message(error)}<form method="post" action="/profile/password"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">
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
): string {
  const cards = members.length
    ? members
        .map(
          (member) =>
            `<article class="card member-card">${member.photo ? `<img class="avatar" src="/members/${member.id}/avatar" alt="${escapeHtml(member.name)}的头像">` : ""}<p class="eyebrow">${escapeHtml(member.cohort || member.join_year || "剧团成员")}</p><h2><a href="/members/${member.id}">${escapeHtml(member.name)}</a></h2><p>${escapeHtml(member.bio || "暂无简介")}</p><p class="muted">🌸 ${member.flower_count}</p></article>`,
        )
        .join("")
    : '<p class="card">没有找到符合条件的队员。</p>';
  const options = years
    .map((year) => `<option value="${year}"${selectedYear === year ? " selected" : ""}>${year}</option>`)
    .join("");
  return layout(
    "队员名录",
    `<section class="page-heading"><p class="eyebrow">HALL OF FAME</p><h1>队员名录</h1><form method="get" class="filters"><input name="q" value="${escapeHtml(search)}" placeholder="搜索姓名、届别或作品"><select name="year"><option value="">全部年份</option>${options}</select><button>查找</button></form></section><section class="card-grid">${cards}</section>`,
    true,
    admin,
  );
}

export function memberDetailPage(member: MemberRow, csrf: string, flower: string, own = false, admin = false): string {
  const notice =
    flower === "sent"
      ? message("今天的花已送达。", "notice")
      : flower === "already"
        ? message("你今天已经送过花了，明天再来吧。")
        : "";
  const edit = admin
    ? `<a class="edit-link" href="/admin/members/${member.id}/edit">编辑队员档案</a>`
    : own
      ? '<a class="edit-link" href="/profile/member">编辑我的简介与代表作</a>'
      : "";
  return layout(
    member.name,
    `<article class="card profile-detail">${member.photo ? `<img class="avatar avatar-large" src="/members/${member.id}/avatar" alt="${escapeHtml(member.name)}的头像">` : ""}<p class="eyebrow">${escapeHtml(member.cohort || member.join_year || "MEMBER")}</p><h1>${escapeHtml(member.name)}</h1>${edit}${notice}<p>${escapeHtml(member.bio || "暂无简介")}</p><h2>代表作</h2><p>${escapeHtml(member.works || "暂无记录")}</p><p>收到 ${member.flower_count} 朵花</p><form method="post" action="/members/${member.id}/flowers"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button>送一朵花</button></form><p><a href="/members">返回队员名录</a></p></article>`,
    true,
    admin,
  );
}

export function memberEditPage(member: MemberRow, csrf: string, admin: boolean, saved: boolean): string {
  const action = admin ? `/admin/members/${member.id}/edit` : "/profile/member";
  const identity = admin
    ? `<label>姓名<input name="name" maxlength="50" value="${escapeHtml(member.name)}" required></label><label>入队年份<input name="join_year" type="number" min="1" max="9999" value="${escapeHtml(member.join_year)}"></label><label>届别<input name="cohort" maxlength="20" value="${escapeHtml(member.cohort)}"></label>`
    : `<p class="muted">姓名与届别需要修改时，请联系管理员。</p>`;
  const avatarForm = admin
    ? member.photo
      ? `<form method="post" action="/admin/members/${member.id}/avatar/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">移除当前头像</button></form>`
      : '<p class="muted">该队员尚未上传头像。</p>'
    : `<form method="post" action="/profile/member/avatar" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>更换头像<input type="file" name="avatar" accept="image/jpeg,image/png,image/webp,image/avif" required></label><span class="hint">支持 JPG、PNG、WebP、AVIF，最大 15MB。</span><button class="secondary">上传头像</button></form>`;
  return layout(
    admin ? "编辑队员档案" : "维护我的档案",
    `<section class="card auth"><p class="eyebrow">MEMBER PROFILE</p><h1>${admin ? "编辑队员档案" : "维护我的档案"}</h1>${saved ? '<p class="notice">队员档案已保存。</p>' : ""}${member.photo ? `<img class="avatar avatar-large" src="/members/${member.id}/avatar" alt="当前头像">` : ""}<form method="post" action="${action}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}">${identity}<label>个人简介<textarea name="bio" maxlength="5000" rows="7">${escapeHtml(member.bio)}</textarea></label><label>代表作与经历<textarea name="works" maxlength="2000" rows="5">${escapeHtml(member.works)}</textarea></label><button>保存档案</button></form><hr>${avatarForm}<p><a href="/members/${member.id}">返回队员档案</a></p></section>`,
    true,
    admin,
  );
}

export function memberApplicationPage(
  csrf: string,
  mode: "bind" | "new",
  members: Array<{ id: number; name: string; cohort: string }>,
  pending: unknown,
): string {
  if (pending)
    return layout(
      "队员认证",
      '<section class="card auth"><h1>申请等待审核</h1><p>管理员审核后，结果会显示在个人中心。暂时不需要重复提交。</p><a href="/profile">返回个人中心</a></section>',
      true,
    );
  const switcher = `<div class="choice-tabs"><a class="${mode === "bind" ? "active" : ""}" href="?type=bind">绑定已有档案</a><a class="${mode === "new" ? "active" : ""}" href="?type=new">申请新档案</a></div>`;
  const common = `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="apply_type" value="${mode}"><label>一句台词或参与经历<textarea name="identity_note" maxlength="1000" rows="4" required></textarea><span class="hint">也可以填写后台分工或排练经历，仅管理员可见。</span></label>`;
  const fields =
    mode === "bind"
      ? `<label>选择我的档案<select name="member_id" required><option value="">请选择</option>${members.map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.cohort ? `（${escapeHtml(member.cohort)}）` : ""}</option>`).join("")}</select></label>`
      : '<label>姓名<input name="name" maxlength="50" required></label><label>入队年份<input name="join_year" type="number" min="1" max="9999"></label><label>届别<input name="cohort" maxlength="20" placeholder="如 2015 届"></label><label>简介<textarea name="bio" rows="4"></textarea></label>';
  return layout(
    "队员认证",
    `<section class="card auth"><p class="eyebrow">MEMBER APPLICATION</p><h1>申请队员认证</h1>${switcher}<form method="post" action="/profile/member-application">${common}${fields}<button>提交申请</button></form></section>`,
    true,
  );
}
