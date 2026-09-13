import { escapeHtml } from "../views";
import type { EditionRow } from "../routes/productions";

export function editionChoice(editions: EditionRow[], selected: number | null = null): string {
  return `<label>资料所属版本<select name="edition_id" data-resource-edition><option value="">作品通用资料 / 不指定版本</option>${editions.map((v) => `<option value="${v.id}" data-production="${v.production_id}"${v.id === selected ? " selected" : ""}>${escapeHtml(v.year || "年份待补")} · ${escapeHtml(v.name)}</option>`).join("")}</select><span class="hint">先选作品，再选版本；旧资料默认保留为作品通用资料。</span></label>`;
}
