import { escapeHtml as e, layout } from "../views";
import { IMPORT_SCHEMA, type ImportBatch, type ImportRow, type MemberMatch } from "../services/credit-import/schema";

const root = "/admin/credit-imports";
const status: Record<string, string> = {
  preview: "待处理",
  ready: "待确认",
  committed: "已导入",
  rolled_back: "已撤销",
  rollback_conflict: "部分撤销 · 有保留项",
  failed: "已过期",
};
const shell = (title: string, body: string) =>
  layout(
    title,
    `<section class="credit-import"><p><a href="${root}">导入历史</a> · <a href="/productions">作品档案</a></p>${body}</section>`,
    true,
    true,
  );
const token = (csrf: string) => `<input type="hidden" name="csrf" value="${e(csrf)}">`;
export function importUploadPage(
  production: { id: number; title: string },
  editions: { id: number; name: string; year: number | null }[],
  csrf: string,
) {
  const base = `/admin/productions/${production.id}/credits/import`;
  return shell(
    "导入演职人员",
    `<header><p class="eyebrow">${e(production.title)}</p><h1>导入演职人员</h1><p>只添加当前作品版本的演职关联，不替换原名单，不修改队员简介或照片。</p></header>
    <div class="import-steps"><section><h2>1. 下载并填写</h2><p><a class="button" href="${base}/template.xlsx">下载 XLSX 模板</a> <a href="${base}/template.csv">下载 CSV 模板</a></p><p>v${IMPORT_SCHEMA.version} · 最多 ${IMPORT_SCHEMA.maxRows} 行 · 5MB 以内</p><p>必填：姓名、类别、角色或分工。外部ID选填，已有档案按编号或姓名匹配；同名档案由管理员确认。</p><details><summary>填写说明</summary><ul><li>第 2 行为示例，第 3 行起填写；仅完全未改动的示例行会跳过。</li><li>类别填写“演员”或“后台与创作”；一人多角、AB 角分别写多行。</li><li>姓名最多 50 字，角色或分工最多 80 字。外部ID为稳定唯一编号。</li><li>空值留空；CSV 使用 UTF-8。禁止公式、宏、合并单元格、照片和附件。</li><li>仅新增关联，完全相同的关联自动跳过。未建档人员不会直接创建，需在预览中明确选择。</li></ul></details></section>
    <section><h2>2. 上传预览</h2><form method="post" enctype="multipart/form-data" action="${base}/preview">${token(csrf)}<label>演出版本<select name="edition_id" required>${editions.map((v) => `<option value="${v.id}">${e(v.year || "年份待补")} · ${e(v.name)}</option>`).join("")}</select></label><label>导入文件<input type="file" name="file" accept=".xlsx,.csv" required></label><p class="hint">上传只生成预览。检查并确认后才会写入演职名单。</p><button>上传并预览</button></form></section></div>`,
  );
}
export function importHistoryPage(rows: ImportBatch[], page: number) {
  return shell(
    "演职人员导入历史",
    `<h1>导入历史</h1><p>在作品详情的演职人员管理区发起导入。明细保留 180 天，操作摘要长期保留。</p><div class="import-history">${rows.length ? rows.map((b) => `<article><p class="eyebrow">${e(status[b.status] || b.status)}</p><h2><a href="${root}/${b.id}">${e(b.production_title)}</a></h2><p>${e(b.edition_label)} · ${b.total_rows} 行</p><p class="muted">${e(b.actor_name)} · ${e(b.created_at)}${b.details_purged ? " · 明细已到期清理" : ""}</p></article>`).join("") : "<p>暂无导入记录。</p>"}</div><nav aria-label="导入历史分页">${page > 1 ? `<a href="${root}?page=${page - 1}">上一页</a> ` : ""}${rows.length === 20 ? `<a href="${root}?page=${page + 1}">下一页</a>` : ""}</nav>`,
  );
}
export function importBatchPage(
  b: ImportBatch,
  rows: ImportRow[],
  members: MemberMatch[],
  events: { actor_name: string; summary: string; created_at: string }[],
  changes: { member_id: number; change_type: string; outcome: string }[],
  csrf: string,
  search: string,
) {
  const editing = ["preview", "ready"].includes(b.status) && !b.details_purged;
  const url = `${root}/${b.id}`;
  const outcomes: Record<string, string> = {
    created: "已新增",
    skipped: "已跳过",
    removed: "已撤销",
    absent: "记录已不存在",
    kept: "有后续修改或引用，已保留",
  };
  const line = (r: ImportRow) => {
    const state = r.outcome
      ? outcomes[r.outcome]
      : r.resolution === "matched"
        ? "将新增关联"
        : r.resolution === "create"
          ? "将新建最小档案并关联"
          : r.error_message;
    return `<article class="import-row"><div><p class="eyebrow">第 ${r.row_number} 行 · ${e(state || "待确认")}</p><h3>${e(r.member_name || "姓名未填写")}</h3><p>${e(r.kind === "cast" ? "演员" : r.kind === "crew" ? "后台与创作" : r.kind)} · ${e(r.role_name || "角色未填写")}</p><p class="muted">${r.matched_member_id ? `档案 #${r.matched_member_id} · ` : ""}${e(r.external_id || r.generated_external_id || "未填写外部ID")}</p>${r.error_message && r.outcome ? `<p>${e(r.error_message)}</p>` : ""}</div>${editing ? `<label>第 ${r.row_number} 行处理<select name="decision_${r.row_number}"><option value="keep">保留当前选择</option><option value="auto">重新自动匹配</option>${!r.input_error ? '<option value="create">新建最小档案（仅姓名和外部ID）</option>' : ""}<option value="skip">排除此行，不导入</option>${members.map((m) => `<option value="match:${m.id}">关联：${e(m.name)} · #${m.id}${m.cohort ? ` · ${e(m.cohort)}` : ""}${m.external_id ? ` · ${e(m.external_id)}` : ""}</option>`).join("")}</select></label>` : ""}</article>`;
  };
  return shell(
    "导入预览与结果",
    `<header><p class="eyebrow">${e(status[b.status] || b.status)}</p><h1>${e(b.production_title)}</h1><p>${e(b.edition_label)} · ${e(b.original_name || "原文件名已清理")}</p></header>
    <p class="import-summary">${b.add_count} 条${b.committed_at ? "新增关联" : "待新增关联"} · ${b.create_member_count} 份新档案 · ${b.skip_count} 行跳过 · ${b.error_count} 行待处理</p>
    ${b.status === "committed" ? '<p class="notice" role="status">导入完成。重复确认不会再次创建记录。</p>' : ""}${b.status === "rollback_conflict" ? '<p class="notice">安全部分已撤销。有后续修改或引用的记录已保留，请核对下方明细，不会强行删除。</p>' : ""}
    ${b.production_id ? `<p><a href="/productions/${b.production_id}?edition=${b.edition_id || ""}#manage-credits">查看作品名单</a> · <a href="/admin/productions/${b.production_id}/credits/import">上传另一份表格</a></p>` : ""}
    ${b.details_purged ? "<p>明细已超过 180 天并清理，不再提供撤销或错误报告。</p>" : `<p><a href="${url}/errors.csv">下载错误与跳过行报告</a></p>`}
    ${editing ? `<form method="get" action="${url}" class="import-search"><label>搜索可关联档案<input name="q" maxlength="80" value="${e(search)}" placeholder="姓名或外部ID"></label><button class="secondary">查找档案</button></form><p class="hint">下拉框最多列出 100 份档案；找不到时先搜索，再选择。搜索前请保存已经做出的选择。</p><form method="post" action="${url}/resolve">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}">${rows.map(line).join("")}<button>保存选择并重新检查</button></form>` : rows.map(line).join("")}
    ${b.status === "ready" && !b.details_purged ? `<form class="import-confirm" method="post" action="${url}/confirm">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}"><label><input type="checkbox" name="confirm" value="yes" required>已核对版本、人员和角色，同意新增 ${b.add_count} 条关联及 ${b.create_member_count} 份最小档案</label><p class="hint">全有全无；若数据已变化，将停止提交并要求重新检查。填写外部ID且已有档案编号为空时，会补充该编号。</p><button>确认入库</button></form>` : ""}
    ${["committed", "rollback_conflict"].includes(b.status) && !b.details_purged ? `<details class="import-confirm"><summary>撤销本批导入</summary><p>只移除本批新增且未被修改的关联。新档案有后续修改、账号绑定或其他引用时会保留。</p><form method="post" action="${url}/rollback">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}"><label><input type="checkbox" name="confirm" value="yes" required>确认按安全规则撤销此批次</label><button class="danger">撤销导入</button></form></details>` : ""}
    ${changes.length ? `<details><summary>档案变更明细</summary><ul>${changes.map((c) => `<li>档案 #${c.member_id} · ${c.change_type === "created" ? "新建" : "补充外部ID"} · ${e(outcomes[c.outcome] || "已应用")}</li>`).join("")}</ul></details>` : ""}
    <details><summary>操作记录</summary><ul>${events.map((v) => `<li>${e(v.created_at)} · ${e(v.actor_name)}：${e(v.summary)}</li>`).join("")}</ul></details>`,
  );
}
