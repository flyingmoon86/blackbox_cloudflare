import { adminPageUrl, type AdminPage } from "../http/pagination";
import { escapeHtml as e } from "../views";

export function adminPagination(info: AdminPage, label = "内容分页", anchor = ""): string {
  const pages = Math.max(1, Math.ceil(info.total / info.size));
  return `<nav class="pagination" aria-label="${e(label)}">${info.page > 1 ? `<a href="${e(adminPageUrl(info, info.page - 1) + anchor)}">上一页</a>` : ""}<span>共 ${info.total} 条 · 第 ${info.page} / ${pages} 页</span>${info.page < pages ? `<a href="${e(adminPageUrl(info, info.page + 1) + anchor)}">下一页</a>` : ""}</nav>`;
}

export function listReturnInput(path: string): string {
  return `<input type="hidden" name="return_to" value="${e(path)}">`;
}

export function filterSelect(name: string, value: string, choices: Record<string, string>): string {
  return `<select name="${e(name)}">${Object.entries(choices)
    .map(([key, label]) => `<option value="${e(key)}"${key === value ? " selected" : ""}>${e(label)}</option>`)
    .join("")}</select>`;
}
