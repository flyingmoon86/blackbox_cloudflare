import { siteEditor } from "./site-editor";
import type { AnnouncementRow, SiteProfileRow } from "../routes/content";
import { escapeHtml, layout } from "../views";

export function announcementListPage(items: AnnouncementRow[], admin: boolean, csrf: string, signedIn = true): string {
  const rows = items.length
    ? items
        .map(
          (x) =>
            `<article class="card"><p class="eyebrow">${escapeHtml(x.created_at.slice(0, 10))}</p><h2><a href="/announcements/${x.id}">${escapeHtml(x.title)}</a></h2><p>${escapeHtml(x.content.slice(0, 160))}</p>${admin ? `<form method="post" action="/admin/announcements/${x.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary small">删除</button></form>` : ""}</article>`,
        )
        .join("")
    : '<p class="card">暂无公告。</p>';
  return layout(
    "公告",
    `<section class="page-heading"><p class="eyebrow">NOTICE</p><h1>剧团公告</h1>${admin ? '<a class="button" href="/admin/announcements/new">发布公告</a>' : ""}</section><section class="review-grid">${rows}</section>`,
    signedIn,
    admin,
  );
}
export function announcementDetailPage(item: AnnouncementRow, admin: boolean, csrf: string, signedIn = true): string {
  return layout(
    item.title,
    `<article class="card profile-detail"><p class="eyebrow">${escapeHtml(item.created_at.slice(0, 10))}</p><h1>${escapeHtml(item.title)}</h1><p class="preline">${escapeHtml(item.content)}</p>${admin ? `<form method="post" action="/admin/announcements/${item.id}/delete"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button class="secondary">删除公告</button></form>` : ""}<p><a href="/announcements">返回公告列表</a></p></article>`,
    signedIn,
    admin,
  );
}
export function announcementFormPage(csrf: string): string {
  return layout(
    "发布公告",
    `<section class="card auth"><p class="eyebrow">NOTICE EDITOR</p><h1>发布公告</h1><form method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>标题<input name="title" maxlength="100" required></label><label>正文<textarea name="content" rows="10"></textarea></label><button>发布</button></form></section>`,
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
  return layout("页面管理", siteEditor(p, productions, photos, csrf, saved), true, true);
}
