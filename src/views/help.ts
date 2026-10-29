import { layout } from "./layout";
import { handbook } from "../content/member-handbook";
import { escapeHtml as e } from "./html";
import { assetUrl } from "./assets";
function illustration(id: string, title: string) {
  const url = assetUrl(`/images/handbook/${id}.png`);
  return `<figure class="handbook-figure"><a href="${url}" target="_blank" rel="noopener" aria-label="放大查看${e(title)}操作截图"><img src="${url}" alt="${e(title)}操作界面（演示资料）" loading="lazy"></a><figcaption>${e(title)} · 演示页面，点击图片放大</figcaption></figure>`;
}
export function helpPage(signedIn = false, admin = false) {
  const chapters = handbook.chapters;
  return layout(
    "队员使用手册",
    `<link rel="stylesheet" href="${assetUrl("/handbook.css")}"><article class="handbook"><header class="handbook-cover"><p>BLACK BOX · MEMBER HANDBOOK / 2026.10</p><h1>把舞台的记忆<br>留在这里<span>。</span></h1><p>队员使用手册 · 按你要做的事，找到下一步。</p><a href="/profile">进入个人中心 ↗</a></header><nav class="handbook-toc" aria-label="手册目录">${chapters.map((c, i) => `<a href="#${c.id}">${i + 1}. ${e(c.title)}</a>`).join("")}${admin ? '<a href="#admin-appendix">附录 · 管理员</a>' : ""}</nav><div class="handbook-body">${chapters.map((c, i) => `<section id="${c.id}"><p class="handbook-label">0${i + 1} / ${e(c.audience)}</p><h2>${e(c.title)}</h2>${illustration(c.id, c.title)}<ol>${c.steps.map((s) => `<li>${e(s)}</li>`).join("")}</ol><p class="handbook-note">${e(c.note)}</p><a href="${c.href}">${e(c.link)} ↗</a>${c.id === "upload" ? ' · <a href="/my-resources">我的提交 ↗</a>' : ""}</section>`).join("")}${admin ? `<section id="admin-appendix"><p class="handbook-label">APPENDIX / 仅管理员</p><h2>管理员操作附录</h2>${illustration("admin", "工作台待办入口")}${handbook.admin.map((a) => `<h3><a href="${a.href}">${e(a.title)} ↗</a></h3><p>${e(a.text)}</p>`).join("")}</section>` : ""}</div><footer>黑匣子话剧队 · 更新于 2026-10-28</footer></article>`,
    signedIn,
    admin,
  );
}
