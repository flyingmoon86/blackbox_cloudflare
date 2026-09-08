export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · 黑匣子</title><link rel="stylesheet" href="/app.css"></head>
<body><header class="top"><a href="/" class="brand">黑匣子</a></header><main>${content}</main></body></html>`;
}

export function loginPage(csrf: string, error = "", next = "/"): string {
  const alert = error ? `<p class="alert" role="alert">${escapeHtml(error)}</p>` : "";
  return layout("登录", `<section class="card auth"><p class="eyebrow">BLACK BOX</p><h1>欢迎回家</h1>
  <p class="muted">登录后查看剧团公告、作品与内部资料。</p>${alert}
  <form method="post" action="/login">
    <input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><input type="hidden" name="next" value="${escapeHtml(next)}">
    <label>用户名<input name="username" autocomplete="username" maxlength="50" required></label>
    <label>密码<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">登录</button>
  </form></section>`);
}

export function publicHome(): string {
  return layout("首页", `<section class="hero"><div><p class="eyebrow">BLACK BOX THEATRE</p><h1>黑匣子永远是你的家</h1>
  <p>保存每一次排练、演出与相遇。</p><a class="button" href="/login">登录查看剧团档案</a></div></section>
  <section class="two-column"><article class="card"><h2>关于我们</h2><p>这里记录话剧队共同创作的作品和故事。</p></article>
  <article class="card"><h2>联系我们</h2><p><a href="mailto:moonflying56@gmail.com">moonflying56@gmail.com</a></p></article></section>`);
}

export function memberHome(username: string, csrf: string, role: string): string {
  return layout("队员首页", `<section class="card"><p class="eyebrow">${escapeHtml(role)}</p><h1>${escapeHtml(username)}，欢迎回来</h1>
  <p>TypeScript 单 Worker 的账号基础功能已接通 D1。作品、资源和后台将在后续阶段逐项迁移。</p>
  <form method="post" action="/logout"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">退出登录</button></form></section>`);
}
