import { escapeHtml as h } from "./html";
import { layout } from "./layout";
import type { ArchiveStatistics } from "../services/archive-statistics";
import type { AdminPage } from "../http/pagination";
import { adminPagination } from "./admin-pagination";
import { assetUrl } from "./assets";

const yearLabel = (year: number | null) => (year === null ? "年份未填" : String(year));
function table(label: string, headers: string[], rows: string[][], empty: string) {
  if (!rows.length) return `<p class="archive-empty">${h(empty)}</p>`;
  return `<div class="table-wrap" tabindex="0" role="region" aria-label="${h(label)}，可横向滚动"><table><caption class="visually-hidden">${h(label)}</caption><thead><tr>${headers.map((label) => `<th scope="col">${h(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function range(info: AdminPage) {
  if (!info.total) return "共 0 条";
  return `共 ${info.total} 条 · 当前第 ${(info.page - 1) * info.size + 1}–${Math.min(info.page * info.size, info.total)} 条`;
}

export function archiveStatisticsPage(data: ArchiveStatistics, expanded = { editions: false, members: false }): string {
  const { filter, summary: s, reviews: r } = data;
  const year = filter.year === null ? "" : String(filter.year);
  const option = (value: string, label: string, selected: string) =>
    `<option value="${h(value)}"${value === selected ? " selected" : ""}>${h(label)}</option>`;
  const years = data.yearChoices.filter((value): value is number => value !== null);
  if (typeof filter.year === "number" && !years.includes(filter.year)) years.push(filter.year);
  years.sort((a, b) => b - a);
  const choices =
    option("", "全部年份", year) +
    years.map((value) => option(String(value), String(value), year)).join("") +
    option("missing", "年份未填", year);
  const visibility = [
    ["all", "全部作品状态"],
    ["public", "公开作品"],
    ["hidden", "隐藏作品"],
  ]
    .map(([value, label]) => option(value, label, filter.visibility))
    .join("");
  const scope = [
    filter.year === null ? "全部年份" : filter.year === "missing" ? "年份未填" : String(filter.year),
    filter.productionId === null ? "全部作品" : data.productions.find((p) => p.id === filter.productionId)!.title,
    { all: "全部作品状态", public: "公开作品", hidden: "隐藏作品" }[filter.visibility],
  ].join(" · ");
  const metric = (label: string, value: number, key: string) =>
    `<div class="archive-metric"><dt>${h(label)}</dt><dd data-archive-stat="${key}">${value}</dd></div>`;
  const filtered = filter.year !== null || filter.productionId !== null || filter.visibility !== "all";
  const pager = (info: AdminPage, key: "editions" | "members", label: string) =>
    adminPagination({ ...info, params: { ...info.params, detail: key } }, label, `#archive-${key}`);
  return layout(
    "档案统计",
    `<link rel="stylesheet" href="${assetUrl("/archive-statistics.css")}">
    <div class="workbench archive-statistics">
    <header class="wb-heading"><div><h1>档案统计</h1><p class="archive-scope">${filtered ? h(scope) : "全部档案"}</p></div></header>
    <details class="wb-panel archive-disclosure archive-filter">
      <summary><span>${filtered ? "调整筛选" : "筛选档案"}</span><span class="archive-disclosure-hint">年份 / 状态</span></summary>
    <form method="get" action="/admin/archive-statistics" class="wb-panel archive-statistics-filter">
      <label>演出年份<select name="year">${choices}</select></label>
      <label>作品可见状态<select name="visibility">${visibility}</select></label>
      <div class="archive-filter-actions"><button type="submit">查看统计</button><a href="/admin/archive-statistics">重置筛选</a></div>
    </form></details>
    <section class="wb-panel archive-summary" aria-label="档案总览">
      <dl class="archive-metrics">${metric("作品", s.productions, "productions")}${metric("演出版本", s.editions, "editions")}${metric("参与成员", s.people, "people")}${metric("全部资料", r.total, "review-total")}</dl>
      <p class="archive-attention">待审资料 <strong data-archive-stat="review-pending">${r.pending}</strong> 份<span>·</span>缺少已批准剧本的版本 <strong>${s.missing_script}</strong> 个<span>·</span>缺少已批准照片的版本 <strong>${s.missing_photo}</strong> 个</p>
    </section>
    <details class="wb-panel archive-disclosure" id="archive-years"><summary><span>历年档案</span><span class="archive-disclosure-hint">${data.years.length} 个年份分组</span></summary>
      ${table(
        "历年档案",
        ["演出年份", "作品", "版本", "参与人数", "已批准资料"],
        data.years.map((row) => [
          h(yearLabel(row.year)),
          ...[row.productions, row.editions, row.people, row.approved].map(h),
        ]),
        "当前范围没有演出版本，可以调整上方筛选。",
      )}
    </details>
    <details class="wb-panel archive-disclosure" id="archive-editions"${expanded.editions ? " open" : ""}><summary><span>版本资料覆盖</span><span class="archive-disclosure-hint">${s.editions} 个版本</span></summary><p class="archive-detail-note">${range(data.editionsPagination)}。类型列只计已批准资料。</p>
      ${table(
        "版本资料覆盖",
        ["作品与版本", "年份", "参与人数 / 演职记录", "照片", "剧本", "音频", "视频", "其他", "待审 / 驳回"],
        data.editions.map((row) => [
          `<a data-archive-edition="${row.edition_id}" href="/productions/${row.production_id}?edition=${row.edition_id}">${h(row.production_title)} · ${h(row.edition_name)}</a>${row.is_hidden ? "（隐藏）" : ""}`,
          h(yearLabel(row.year)),
          `${row.member_count} / ${row.credit_count}`,
          ...[row.photo_count, row.script_count, row.audio_count, row.video_count, row.other_count].map(h),
          `${row.pending_count} / ${row.rejected_count}`,
        ]),
        "当前范围没有演出版本，可以调整上方筛选。",
      )}
      ${pager(data.editionsPagination, "editions", "版本资料覆盖分页")}
    </details>
    <details class="wb-panel archive-disclosure" id="archive-members"${expanded.members ? " open" : ""}><summary><span>成员参与</span><span class="archive-disclosure-hint">${s.people} 名成员</span></summary><p class="archive-detail-note">${range(data.membersPagination)}。按参与版本数、演职记录数排列。</p>
      ${table(
        "成员参与",
        ["队员", "参与作品", "参与版本", "演员记录", "幕后记录", "演职记录"],
        data.members.map((row) => [
          `<a data-archive-member="${row.member_id}" href="/members/${row.member_id}">${h(row.member_name)}</a>`,
          ...[row.productions, row.editions, row.cast_count, row.crew_count, row.credits].map(h),
        ]),
        "当前范围没有演职记录，可以调整上方筛选。",
      )}
      ${pager(data.membersPagination, "members", "成员参与分页")}
    </details>
    <details class="wb-panel archive-disclosure" id="archive-reviews"><summary><span>审核与统计说明</span><span class="archive-disclosure-hint">按需查看</span></summary>
      <div class="archive-notes"><p>当前范围：已批准 <strong data-archive-stat="review-approved">${r.approved}</strong> 份，已驳回 <strong data-archive-stat="review-rejected">${r.rejected}</strong> 份；未归属作品 <strong data-archive-stat="unassigned">${r.unassigned}</strong> 份。未归属作品的资料只在全部年份、全部作品且未选隐藏作品时计入。</p>
      <p>版本内已批准资料 <strong data-archive-stat="approved">${s.approved}</strong> 份；当前范围可公开展示的资料 <strong data-archive-stat="public-resources">${s.publicResources}</strong> 份。隐藏作品的公开展示数为 0。历年资料数仅计版本内已批准记录。</p>
      <p>参与人数按当前范围去重，同一人多角色只计一人，跨年份人数不能相加。共有演职记录 <strong data-archive-stat="credits">${s.credits}</strong> 条，演员、幕后列计角色记录。缺剧本、照片指缺少已批准资料，不代表没有待审或已驳回文件。</p>
      <p>所有汇总均统计全部筛选结果，不受明细分页影响。“年份未填”指演出版本，与未归属作品的资料分开统计。</p>
      <p>有审核人且时间有效的已完成审核 <strong>${r.manual_samples}</strong> 份${r.average_review_hours === null ? "；尚无可计算耗时的样本。" : `；平均 ${r.average_review_hours.toFixed(2)} 小时。`}</p>
      <p>耗时从创建到当前审核时间；无审核人、未完成审核、缺少时间或负耗时不计入。审核信息仅显示汇总。</p></div>
    </details></div>`,
    true,
    true,
  );
}
