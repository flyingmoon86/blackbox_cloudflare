import { escapeHtml } from "../views";
export const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
export function yearSelect(name: string, value: unknown = ""): string {
  const selected = String(value ?? "");
  const legacy = selected && !YEARS.some((year) => String(year) === selected);
  return `<select name="${name}"><option value="">${legacy ? "保留原年份（" + escapeHtml(selected) + "）" : "未填写"}</option>${YEARS.map((year) => `<option value="${year}"${String(year) === selected ? " selected" : ""}>${year}</option>`).join("")}</select>`;
}
export function archiveTabs(active: "productions" | "resources"): string {
  return `<nav class="section-tabs" aria-label="作品与资料"><a href="/productions"${active === "productions" ? ' class="active" aria-current="page"' : ""}>${icon("productions")}作品档案</a><a href="/resources"${active === "resources" ? ' class="active" aria-current="page"' : ""}>${icon("resources")}资料库</a></nav>`;
}
export function icon(name: string): string {
  const paths: Record<string, string> = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>',
    productions: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 5l3 5m3-5 3 5"/>',
    resources: '<path d="M3 7h7l2 3h9v10H3Z"/><path d="M3 7V4h7l2 3h8v3"/>',
    members:
      '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
    help: '<path d="M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Zm0 0v16"/>',
    thanks: '<path d="M12 21S2 15 2 8a5 5 0 0 1 10-1 5 5 0 0 1 10 1c0 7-10 13-10 13Z"/>',
  };
  return `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}
export type PageInfo = {
  page: number;
  total: number;
  size: number;
  path: string;
  query?: string;
  year?: number | null;
};
export function pageNumber(value: string | undefined): number {
  return value && /^[1-9]\d{0,6}$/.test(value) ? Number(value) : 1;
}
export function pagination(info?: PageInfo): string {
  if (!info || info.total <= info.size) return "";
  const pages = Math.ceil(info.total / info.size);
  const href = (page: number) =>
    info.path +
    "?" +
    new URLSearchParams({
      ...(info.query ? { q: info.query } : {}),
      ...(info.year ? { year: String(info.year) } : {}),
      page: String(page),
    });
  return `<nav class="pagination" aria-label="内容分页">${info.page > 1 ? `<a href="${escapeHtml(href(info.page - 1))}">上一页</a>` : ""}<span>第 ${info.page} / ${pages} 页</span>${info.page < pages ? `<a href="${escapeHtml(href(info.page + 1))}">下一页</a>` : ""}</nav>`;
}
