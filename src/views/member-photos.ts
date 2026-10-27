import { assetUrl } from "./assets";
import { escapeHtml as e } from "./html";
import { layout } from "./layout";
export type FeaturedPhoto = {
  id: string;
  caption: string;
  status: string;
  members_consent: number;
  archived: number;
  version: number;
};
const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${e(String(value))}">`;
export function memberPhotoGallery(
  memberId: number,
  photos: Array<{ id: string; caption: string }>,
  manage = false,
  admin = false,
) {
  return `${manage ? `<p><a href="${admin ? "/admin/members" : "/profile/members"}/${memberId}/photos">管理精选照片</a></p>` : ""}${photos.length ? `<div class="member-photo-gallery">${photos.map((photo) => `<figure><a data-dossier-photo href="/members/${memberId}/photos/${photo.id}/file" aria-label="放大查看${e(photo.caption || "精选照片")}"><img src="/members/${memberId}/photos/${photo.id}/file" loading="lazy" alt="${e(photo.caption || "个人精选照片")}"></a>${photo.caption ? `<figcaption>${e(photo.caption)}</figcaption>` : ""}</figure>`).join("")}</div>` : '<p class="dossier-empty">精选照片待补充。</p>'}`;
}
export function memberPhotosPage(
  memberId: number,
  name: string,
  photos: FeaturedPhoto[],
  csrf: string,
  admin: boolean,
  saved: boolean,
) {
  const base = `${admin ? "/admin/members" : "/profile/members"}/${memberId}/photos`;
  return layout(
    "个人精选照片",
    `<section class="member-records photo-manager"><link rel="stylesheet" href="${assetUrl("/member-records.css")}"><p><a href="/members/${memberId}#member-photos">${e(name)} · 个人档案</a></p><h1>精选照片</h1><p class="muted">审核通过后，仅认证队员和管理员可见。</p>${saved ? '<p class="notice" role="status">已保存</p>' : ""}${admin ? "<details><summary>添加照片</summary>" : ""}<form class="photo-upload" method="post" action="${base}" enctype="multipart/form-data">${hidden("csrf", csrf)}${hidden("upload_id", crypto.randomUUID())}<label>添加照片<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required><span class="hint">JPG、PNG 或 WebP，每张不超过 8MB</span></label><label>照片说明<input name="caption" maxlength="300" placeholder="选填"></label><label class="photo-consent"><input type="checkbox" name="members_consent" value="1" required><span>同意在个人档案中向认证队员和管理员展示</span></label><button>${admin ? "添加照片" : "提交审核"}</button></form>${admin ? "</details>" : ""}<div class="record-photos">${photos
      .map((photo) => {
        const tokens = hidden("csrf", csrf) + hidden("version", photo.version);
        const status = photo.archived
          ? "已归档"
          : photo.status === "rejected"
            ? "未通过审核"
            : !photo.members_consent
              ? "已撤回展示"
              : photo.status === "approved"
                ? "队内可见"
                : "待审核";
        return `<article class="photo-item">${!photo.archived && photo.status !== "rejected" ? `<img src="/members/${memberId}/photos/${photo.id}/file" alt="${e(photo.caption || "精选照片")}" loading="lazy">` : ""}${photo.caption ? `<p class="photo-caption">${e(photo.caption)}</p>` : ""}<p class="hint">${status}</p>${!photo.archived ? `<details><summary>修改说明</summary><form method="post" action="${base}/${photo.id}">${tokens}<label>照片说明<input name="caption" maxlength="300" value="${e(photo.caption)}" placeholder="选填"></label><button name="action" value="edit">${admin ? "保存说明" : "保存并重新送审"}</button></form></details>` : ""}<form class="record-actions" method="post" action="${base}/${photo.id}">${tokens}${photo.archived ? (admin ? '<button name="action" value="restore" class="secondary">恢复为待审</button>' : "") : `${admin && photo.members_consent && photo.status === "pending" ? '<button name="action" value="approve">通过</button><button name="action" value="reject" class="secondary">不通过</button>' : ""}${photo.members_consent ? '<button name="action" value="withdraw" class="secondary">撤回展示</button>' : '<button name="action" value="publish" class="secondary">同意队内展示并送审</button>'}<button name="action" value="archive" class="secondary">归档</button>`}</form>${admin ? `<a href="${base}/${photo.id}/history">修改历史</a>` : ""}</article>`;
      })
      .join("")}</div>${admin ? '<p><a href="/admin/member-photos">返回照片审核</a></p>' : ""}</section>`,
    true,
    admin,
  );
}

export function memberPhotoReviewPage(
  members: Array<{ id: number; name: string; count: number }>,
  total: number,
  page: number,
  hasNext: boolean,
) {
  return layout(
    "精选照片审核",
    `<section class="member-records"><link rel="stylesheet" href="${assetUrl("/member-records.css")}"><h1>精选照片审核</h1><p class="muted">${total ? `待审核 ${total} 张` : "目前没有待审核的照片。"}</p><ul class="photo-review-list">${members.map((m) => `<li><a href="/admin/members/${m.id}/photos"><span>${e(m.name)}</span><span>${m.count} 张待审 →</span></a></li>`).join("")}</ul>${page > 1 || hasNext ? `<nav aria-label="待审队员分页">${page > 1 ? `<a href="?page=${page - 1}">上一页</a>` : ""}<span>第 ${page} 页</span>${hasNext ? `<a href="?page=${page + 1}">下一页</a>` : ""}</nav>` : ""}</section>`,
    true,
    true,
  );
}
