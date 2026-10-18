import { siteEditor } from "./site-editor";
import type { AnnouncementRow, SiteProfileRow } from "../routes/content";
import { escapeHtml } from "./html";
import { layout } from "./layout";
import { assetUrl } from "./assets";
import { announcementExcerpt, renderAnnouncement, ANNOUNCEMENT_MAX_LENGTH } from "../shared/announcement-markdown";

export function announcementListPage(items: AnnouncementRow[], admin: boolean, csrf: string, signedIn = true): string {
  const rows = items.length
    ? items
        .map(
          (x) =>
            `<article class="announcement-notice"><p class="eyebrow">${escapeHtml(x.created_at.slice(0, 10))}</p><h2><a href="/announcements/${x.id}">${escapeHtml(x.title)}</a></h2><p>${escapeHtml(announcementExcerpt(x.content))}</p>${admin ? `<form method="post" action="/admin/announcements/${x.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary small">删除</button></form>` : ""}</article>`,
        )
        .join("")
    : '<article class="announcement-notice announcement-empty"><p>告示牌暂时空着。</p><p>有新消息时，我们会贴在这里。</p></article>';
  return layout(
    "公告",
    `<section class="page-heading announcement-heading"><p class="eyebrow">公告栏</p><h1>剧团公告</h1>${admin ? '<a class="button" href="/admin/announcements/new">发布公告</a>' : ""}</section><section class="announcement-board" aria-label="剧团公告栏">${rows}</section>`,
    signedIn,
    admin,
  );
}
export function announcementDetailPage(
  item: AnnouncementRow,
  admin: boolean,
  csrf: string,
  signedIn = true,
  publicOrigin = "",
): string {
  return layout(
    item.title,
    `<link rel="stylesheet" href="${assetUrl("/announcement.css")}"><section class="announcement-board announcement-board-single" aria-label="公告告示牌"><article class="announcement-notice announcement-letter"><p class="eyebrow">${escapeHtml(item.created_at.slice(0, 10))}</p><h1>${escapeHtml(item.title)}</h1><div class="announcement-markdown">${renderAnnouncement(item.content, publicOrigin)}</div>${admin ? `<form method="post" action="/admin/announcements/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">删除公告</button></form>` : ""}<p class="announcement-back"><a href="/announcements">← 返回公告列表</a></p></article></section>`,
    signedIn,
    admin,
  );
}
export function announcementFormPage(csrf: string, publicOrigin = ""): string {
  return layout(
    "发布公告",
    `<link rel="stylesheet" href="${assetUrl("/announcement.css")}"><section class="card auth wide announcement-editor" data-announcement-editor data-public-origin="${escapeHtml(publicOrigin)}"><p class="eyebrow">NOTICE EDITOR</p><h1>发布公告</h1><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>标题<input name="title" maxlength="100" required></label>
    <label for="announcement-content">正文（Markdown）</label><p id="announcement-help" class="hint">支持标题、加粗、列表和链接。直接粘贴带链接的文字时，会尽量保留链接。最多 20,000 字符。</p>
    <div class="announcement-tools" data-editor-tools hidden role="group" aria-label="正文排版"><button type="button" class="secondary small" data-format="bold">加粗</button><button type="button" class="secondary small" data-format="heading">小标题</button><button type="button" class="secondary small" data-format="list">列表</button><button type="button" class="secondary small" data-link-open aria-expanded="false" aria-controls="announcement-link">插入链接</button></div>
    <div id="announcement-link" class="announcement-link-editor" hidden><label>链接文字<input data-link-label type="text" maxlength="200" placeholder="例如：注册账号"></label><label>链接地址<input data-link-url type="text" placeholder="/register 或 https://…" inputmode="url"></label><div class="announcement-tools"><button type="button" class="small" data-link-insert>插入</button><button type="button" class="secondary small" data-link-cancel>取消</button></div></div>
    <textarea id="announcement-content" name="content" rows="14" maxlength="${ANNOUNCEMENT_MAX_LENGTH}" aria-describedby="announcement-help" placeholder="## 这次有什么变化？&#10;&#10;欢迎来到 **黑匣子 4.0**。&#10;&#10;- [注册账号](/register)&#10;- [补充资料](/resources/submit)"></textarea>
    <details class="announcement-syntax"><summary>查看格式示例</summary><pre>## 小标题&#10;**需要强调的文字**&#10;- 列表项目&#10;[注册账号](/register)&#10;[网站反馈](/feedback)</pre><p class="hint">链接支持本站路径、http/https 网址和邮箱。纯文字也可以直接发布；不支持插入 HTML 或图片。</p></details>
    <p class="hint" data-editor-status role="status" aria-live="polite"></p><div class="announcement-tools"><button type="button" class="secondary" data-preview-toggle hidden aria-expanded="false" aria-controls="announcement-preview">预览公告</button><button type="submit">发布公告</button></div>
    <noscript><p class="hint">当前未启用脚本，仍可填写 Markdown 并发布；排版将在公告页面显示。</p></noscript></form>
    <section id="announcement-preview" class="announcement-preview" hidden aria-label="公告预览"><p class="eyebrow">发布效果预览</p><h2 data-preview-title></h2><div class="announcement-markdown" data-preview-body></div><p class="hint">预览中的链接在新标签打开，正文会保留。</p></section></section><script src="${assetUrl("/announcement-editor.js")}" defer></script>`,
    true,
    true,
  );
}
export function siteSettingsPage(
  p: SiteProfileRow,
  productions: Array<{ id: number; title: string; year: number | null }>,
  photos: Array<{ id: number; title: string }>,
  csrf: string,
  saved: boolean,
): string {
  return layout("页面编辑", siteEditor(p, productions, photos, csrf, saved), true, true);
}
