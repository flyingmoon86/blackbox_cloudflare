import { assetUrl } from "./assets";
import { layout } from "./layout";
import { escapeHtml as e } from "./html";
import {
  DESTINATIONS,
  DESTINATION_FIELDS,
  detailsOf,
  STATISTICS_NOTE,
  type MemberRecord,
  type recordStatistics,
} from "../services/member-records";

const hidden = (name: string, value: unknown) => `<input type="hidden" name="${name}" value="${e(String(value))}">`;
const shell = (title: string, body: string, admin: boolean, personal = false) =>
  layout(
    title,
    `<section class="member-records${personal ? " graduation-personal" : ""}"><link rel="stylesheet" href="${assetUrl("/member-records.css")}"><h1>${e(title)}</h1>${body}</section>`,
    true,
    admin,
  );

function editor(base: string, csrf: string, record?: MemberRecord) {
  const details: Record<string, string> = record ? detailsOf(record) : {};
  return `<form method="post" action="${base}/save" class="record-form graduation-form">${hidden("csrf", csrf)}${hidden("id", record?.id || crypto.randomUUID())}${hidden("version", record?.version || 0)}${hidden("kind", "destination")}
  <label class="graduation-year">毕业年份<input name="graduation_year" inputmode="numeric" maxlength="4" placeholder="选填" value="${record?.graduation_year || ""}"></label>
  <fieldset class="graduation-choices"><legend>毕业之后</legend>${Object.entries(DESTINATIONS)
    .map(
      ([value, label]) =>
        `<label><input type="radio" name="destination_type" value="${value}"${record?.destination_type === value ? " checked" : ""} required><span>${value === "undecided" ? "还没定" : e(label)}</span></label>`,
    )
    .join("")}</fieldset>
  <div class="graduation-details">${Object.entries(DESTINATION_FIELDS)
    .map(([type, fields]) =>
      Object.entries(fields)
        .map(([key, label]) => {
          const value = record?.destination_type === type ? details[key] || "" : "";
          const name = `${type}_${key}`;
          return `<label data-for="${type}">${e(label)}${key === "notes" ? `<textarea name="${name}" rows="2" maxlength="2000" placeholder="选填">${e(value)}</textarea>` : `<input name="${name}" maxlength="300" placeholder="选填" value="${e(value)}">`}</label>`;
        })
        .join(""),
    )
    .join("")}</div><button>保存</button></form>`;
}
function action(base: string, csrf: string, record: MemberRecord, action: string, label: string) {
  return `<form method="post" action="${base}/${record.id}/action">${hidden("csrf", csrf)}${hidden("version", record.version)}${hidden("action", action)}<button class="secondary">${label}</button></form>`;
}

export function memberRecordsPage(args: {
  name: string;
  base: string;
  csrf: string;
  records: MemberRecord[];
  admin: boolean;
  saved: boolean;
}) {
  const { base, csrf, admin, records } = args;
  const current = records.find((record) => !record.archived),
    archived = records.filter((record) => record.archived);
  return shell(
    admin ? `${args.name} · 毕业去向` : "毕业去向",
    `<p class="muted">仅自己和管理员可见</p>${args.saved ? '<p role="status" class="notice">已保存</p>' : ""}${editor(base, csrf, current)}${current ? `<div class="graduation-secondary">${action(base, csrf, current, "archive", "收起这条去向")}${admin ? `<a href="${base}/${current.id}/history">修改历史</a>` : ""}</div>` : ""}${admin && archived.length ? `<details><summary>已收起的去向</summary>${archived.map((record) => `<div><p>${record.graduation_year || ""} ${record.destination_type ? DESTINATIONS[record.destination_type] : ""}</p>${action(base, csrf, record, "restore", "恢复")}<a href="${base}/${record.id}/history">修改历史</a></div>`).join("")}</details>` : ""}<p><a href="${admin ? "/admin/graduation" : "/profile"}">返回</a></p>`,
    admin,
    !admin,
  );
}

export function recordsAdminPage(
  data: Awaited<ReturnType<typeof recordStatistics>>,
  members: Array<{ id: number; name: string }>,
  page: number,
  hasNext: boolean,
  q: string,
  year: string,
) {
  return shell(
    "毕业去向管理",
    `<section class="card"><h2>年度汇总</h2><details><summary>统计口径</summary><p>${STATISTICS_NOTE}</p></details><form method="get" class="record-filter"><label>毕业年份<input name="year" maxlength="4" value="${e(year)}" placeholder="留空查看全部年份"></label><button>查看统计</button></form><p>全体档案中未建立当前去向记录：${data.missing} 人（不推断毕业年份）</p><a href="/admin/graduation/export${year ? "?year=" + encodeURIComponent(year) : ""}">导出 CSV</a><div class="record-table" tabindex="0" role="region" aria-label="年度统计，可横向滚动"><table><thead><tr>${["毕业年份", "纳入人数", "已确定去向", "保研率", ...Object.values(DESTINATIONS), "未提供去向"].map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${data.rows.map((row) => `<tr>${[row.graduation_year ?? "年份未填", row.total, row.denominator, row.denominator ? (((row.numerator || 0) / row.denominator) * 100).toFixed(1) + "%" : "暂无可计算数据", ...Object.keys(DESTINATIONS).map((k) => row[k]), row.unreported].map((x) => `<td>${e(String(x))}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section><section class="card"><h2>按队员补录</h2><form method="get" class="record-filter">${hidden("year", year)}<label>队员姓名<input name="q" value="${e(q)}" maxlength="50"></label><button>查找队员</button></form><ul>${members.map((m) => `<li><a href="/admin/graduation/${m.id}">${e(m.name)}</a></li>`).join("")}</ul><nav aria-label="队员分页">${page > 1 ? `<a href="?page=${page - 1}&q=${encodeURIComponent(q)}&year=${year}">上一页</a>` : ""} <span>第 ${page} 页</span> ${hasNext ? `<a href="?page=${page + 1}&q=${encodeURIComponent(q)}&year=${year}">下一页</a>` : ""}</nav></section>`,
    true,
  );
}
export function recordHistoryPage(
  base: string,
  history: Array<{ version: number; snapshot: string; actor_id: number; action: string; created_at: string }>,
  photos?: Array<{
    photo_id: string;
    version: number;
    status: string;
    archived: number;
    actor_id: number;
    created_at: string;
  }>,
) {
  return shell(
    "资料修改历史",
    `<p>历史仅供管理员审计。历史值不会自动恢复为当前资料；需要时在编辑表单重新保存。归档可恢复，资料仅本人和管理员可见。</p>${history.map((row) => `<article class="card"><h2>版本 ${row.version} · ${e(row.action)}</h2><p>操作账号 #${row.actor_id} · ${e(row.created_at)} UTC</p><pre>${e(JSON.stringify(JSON.parse(row.snapshot), null, 2))}</pre></article>`).join("")}${photos ? `<details><summary>历史内部照片的审核与归档</summary><pre>${e(JSON.stringify(photos, null, 2))}</pre></details>` : ""}<a href="${base}">返回资料</a>`,
    true,
  );
}
