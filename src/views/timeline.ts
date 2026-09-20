import { escapeHtml, layout } from "../views";
import { archiveTabs } from "./shared";
import type { UserSession } from "../types";

export type TimelineRow = {
  is_hidden?: number;
  id: number;
  title: string;
  year: number | null;
  editions: number;
  people: number;
  resources: number;
  cover: number | null;
  photo: number | null;
};

export function timelinePage(rows: TimelineRow[], user: UserSession | null): string {
  const groups = new Map<number | null, TimelineRow[]>();
  for (const row of rows) groups.set(row.year, [...(groups.get(row.year) || []), row]);
  return layout(
    "演出时间轴",
    `${archiveTabs("productions")}<section class="page-heading"><a href="/productions">← 作品档案</a><h1>演出时间轴</h1><p>沿着年份，重访每一次登台。</p><p class="muted">按演出版本年份归档；数量为当年版本、去重演职员和已入库资料。跨年复排会在对应年份出现。</p></section><div class="performance-timeline">${
      [...groups]
        .map(
          ([year, items]) =>
            `<section class="timeline-year" aria-labelledby="year-${year ?? "unknown"}"><h2 id="year-${year ?? "unknown"}">${year ?? "年份待补"}</h2><div class="timeline-works">${items
              .map((item) => {
                const image = item.cover
                  ? `/productions/${item.id}/cover?v=${item.cover}`
                  : item.photo
                    ? `/resources/${item.photo}/preview`
                    : "";
                return `<article class="timeline-work"><a href="/productions/${item.id}" class="timeline-link">${image ? `<img src="${image}" alt="" loading="lazy" width="640" height="400">` : '<span class="timeline-placeholder">影像待补</span>'}<h3>${escapeHtml(item.title)}</h3>${user?.role === "admin" && item.is_hidden ? '<span class="role-badge">已隐藏 · 仅管理员可见</span>' : ""}</a><p class="timeline-counts"><span>${item.editions} 个版本</span><span>${item.people} 位演职员</span><span>${item.resources ? `${item.resources} 份资料` : "暂无入库资料"}</span></p></article>`;
              })
              .join("")}</div></section>`,
        )
        .join("") || '<p class="notice">还没有演出记录。</p>'
    }</div>`,
    Boolean(user),
    user?.role === "admin",
  );
}
