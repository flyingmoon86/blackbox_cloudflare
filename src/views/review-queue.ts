import { tryGetContext } from "hono/context-storage";
import type { AppEnv } from "../types";
import { escapeHtml } from "../views";

export function reviewQueue(kind: string, cards: string): string {
  const owner = tryGetContext<AppEnv>()?.get("user")?.id || 0;
  return `<section data-review-queue="${escapeHtml(kind)}" data-review-owner="${owner}"><div class="review-tools" hidden><label>搜索待办<input type="search" data-review-query maxlength="100" placeholder="姓名、作品或资料关键词"></label><label>类别<select data-review-filter><option value="">全部类别</option></select></label><button type="button" class="secondary" data-review-clear>清除筛选</button><p class="hint" data-review-count role="status"></p></div><p class="notice" data-review-feedback role="status" hidden></p><div class="review-grid">${cards}</div></section>`;
}

export function reviewAttributes(id: number, category: string, search: string): string {
  return `data-review-id="${id}" data-review-category="${escapeHtml(category)}" data-review-search="${escapeHtml(search)}" tabindex="-1"`;
}
