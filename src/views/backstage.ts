import { escapeHtml as e } from "../views";
import type { EditionRow } from "../routes/productions";

export function backstageCard(v: EditionRow): string {
  if (!v.rehearsal_place && !v.duration_minutes && !v.backstage_story) return "";
  return `<aside class="edition-supplement" aria-labelledby="supplement-${v.id}"><h3 id="supplement-${v.id}">补充信息</h3><dl>${v.rehearsal_place ? `<div><dt>排练地点</dt><dd>${e(v.rehearsal_place)}</dd></div>` : ""}${v.duration_minutes ? `<div><dt>演出时长</dt><dd>${v.duration_minutes} 分钟</dd></div>` : ""}</dl>${v.backstage_story ? `<p class="preline">${e(v.backstage_story)}</p>` : ""}</aside>`;
}

export function backstageFields(v: EditionRow): string {
  return `<fieldset><legend>补充信息（选填）</legend><p class="hint">只填写真实内容，留空不展示。导演和编剧继续在演职员中维护。</p><label>排练地点<input name="rehearsal_place" maxlength="100" value="${e(v.rehearsal_place)}"></label><label>演出时长（分钟）<input type="number" name="duration_minutes" min="1" step="1" value="${e(v.duration_minutes)}"></label><label>补充说明<textarea name="backstage_story" maxlength="1000" rows="4">${e(v.backstage_story)}</textarea></label></fieldset>`;
}
