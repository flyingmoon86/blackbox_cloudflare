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
export function importStartPage(productions: { id: number; title: string; year: number | null; is_hidden: number }[]) {
  return shell(
    "选择导入作品",
    `<header><h1>表格导入演职人员</h1><p>先选择已有作品，再选择演出版本并上传表格。无需填写作品或人员编号。</p></header>${productions.length ? `<form class="import-start" method="get" action="${root}/new"><label>所属作品<select name="production_id" required><option value="">请选择作品</option>${productions.map((p) => `<option value="${p.id}">${e(p.title)} · ${e(p.year || "年份待补")}${p.is_hidden ? " · 已隐藏" : ""}</option>`).join("")}</select></label><button>选择版本并上传</button></form>` : '<p>还没有作品，请先创建作品与演出版本。</p><a class="button" href="/admin/productions/new">创建作品</a>'}`,
  );
}
export function importUploadPage(
  production: { id: number; title: string },
  editions: { id: number; name: string; year: number | null }[],
  csrf: string,
) {
  const base = `/admin/productions/${production.id}/credits/import`;
  return shell(
    "导入演职人员",
    `<header><p class="eyebrow">${e(production.title)}</p><h1>导入演职人员</h1><p>只添加当前作品版本的演职关联，不替换原名单，不修改队员简介或照片。</p></header>
    <div class="import-steps"><section><h2>1. 下载并填写</h2><p><a class="button" href="${base}/template.xlsx">下载 XLSX 模板</a> <a href="${base}/template.csv">下载 CSV 模板</a></p><p>v${IMPORT_SCHEMA.version} · 最多 ${IMPORT_SCHEMA.maxRows} 行 · 5MB 以内</p><p>只填写三列：姓名、类别、角色或分工。系统按姓名匹配档案；未找到或有多个同名时，由管理员确认。</p><details><summary>填写说明</summary><ul><li>第 2 行为示例，第 3 行起填写；仅完全未改动的示例行会跳过。</li><li>类别填写“演员”或“后台与创作”；一人多角、AB 角分别写多行。</li><li>姓名最多 50 字，角色或分工最多 80 字，无需填写任何编号。</li><li>空值留空；CSV 使用 UTF-8。禁止公式、宏、合并单元格、照片和附件。</li><li>仅新增关联，完全相同的关联自动跳过。未建档人员不会直接创建，需在预览中明确选择。</li><li>此前下载的 v1 模板仍可导入，无需重新整理已填写的数据。</li></ul></details></section>
    <section><h2>2. 上传预览</h2><form method="post" enctype="multipart/form-data" action="${base}/preview">${token(csrf)}<label>演出版本<select name="edition_id" required>${editions.map((v) => `<option value="${v.id}">${e(v.year || "年份待补")} · ${e(v.name)}</option>`).join("")}</select></label><label>导入文件<input type="file" name="file" accept=".xlsx,.csv" required></label><p class="hint">上传只生成预览。检查并确认后才会写入演职名单。</p><button>上传并预览</button></form></section></div>`,
  );
}
export function importHistoryPage(rows: ImportBatch[], page: number) {
  return shell(
    "演职人员导入历史",
    `<h1>导入历史</h1><p><a class="button" href="${root}/new">导入演职人员</a></p><p>明细保留 180 天，操作摘要长期保留。</p><div class="import-history">${rows.length ? rows.map((b) => `<article><p class="eyebrow">${e(status[b.status] || b.status)}</p><h2><a href="${root}/${b.id}">${e(b.production_title)}</a></h2><p>${e(b.edition_label)} · ${b.total_rows} 行</p><p class="muted">${e(b.actor_name)} · ${e(b.created_at)}${b.details_purged ? " · 明细已到期清理" : ""}</p></article>`).join("") : "<p>暂无导入记录。</p>"}</div><nav aria-label="导入历史分页">${page > 1 ? `<a href="${root}?page=${page - 1}">上一页</a> ` : ""}${rows.length === 20 ? `<a href="${root}?page=${page + 1}">下一页</a>` : ""}</nav>`,
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
  const needsAttention = (r: ImportRow) => ["error", "unresolved"].includes(r.resolution);
  const decision = (r: ImportRow, compact = false) =>
    `<label class="${compact ? "import-row-decision" : ""}">第 ${r.row_number} 行处理<select name="decision_${r.row_number}"><option value="keep">保留当前选择</option><option value="auto">重新自动匹配</option>${!r.input_error ? '<option value="create">新建最小档案（仅填写姓名）</option>' : ""}<option value="skip">排除此行，不导入</option>${members.map((m, i) => `<option value="match:${m.id}">候选 ${i + 1}：${e(m.name)} · ${e(m.cohort || "届别未填写")}</option>`).join("")}</select></label>`;
  const line = (r: ImportRow, compact = false) => {
    const state = r.outcome
      ? outcomes[r.outcome]
      : r.resolution === "matched"
        ? "将新增关联"
        : r.resolution === "create"
          ? "将新建最小档案并关联"
          : r.error_message;
    const info = `<div class="import-row-copy"><p class="eyebrow">第 ${r.row_number} 行 · ${e(state || "待确认")}</p><h3>${e(r.member_name || "姓名未填写")}</h3><p>${e(r.kind === "cast" ? "演员" : r.kind === "crew" ? "后台与创作" : r.kind)} · ${e(r.role_name || "角色未填写")}</p>${r.matched_member_id ? `<p class="muted"><a href="/members/${r.matched_member_id}" target="_blank" rel="noopener" aria-label="查看关联档案（新窗口）">查看关联档案</a></p>` : ""}${r.error_message && r.outcome ? `<p>${e(r.error_message)}</p>` : ""}</div>`;
    if (editing && compact)
      return `<article class="import-row import-row--compact">${info}<details><summary>调整关联</summary>${decision(r, true)}</details></article>`;
    return `<article class="import-row${compact ? " import-row--compact" : ""}">${info}${editing ? decision(r) : ""}</article>`;
  };
  const review = editing
    ? (() => {
        const attention = rows.filter(needsAttention);
        const settled = rows.filter((r) => !needsAttention(r));
        return `<form method="post" action="${url}/resolve" class="import-review">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}"><div class="import-review-board"><section class="import-review-attention" aria-labelledby="attention-title"><div class="import-review-heading"><p class="eyebrow">优先处理</p><h2 id="attention-title">需要手动处理 <span>${attention.length}</span></h2><p>只需处理下方异常或未匹配记录。</p></div>${attention.length ? attention.map((r) => line(r)).join("") : '<p class="notice">没有需要手动处理的行，可以直接核对右侧结果。</p>'}</section><aside class="import-review-settled" aria-labelledby="settled-title"><div class="import-review-heading"><p class="eyebrow">已识别</p><h2 id="settled-title">自动匹配与已处理 <span>${settled.length}</span></h2><p>已匹配的记录只需核对；需要时展开调整。</p></div>${settled.length ? settled.map((r) => line(r, true)).join("") : "<p>暂无记录。</p>"}</aside></div><div class="import-review-actions"><button>保存选择并重新检查</button></div></form>`;
      })()
    : `<div class="import-result-list">${rows.map((r) => line(r, true)).join("")}</div>`;
  return shell(
    "导入预览与结果",
    `<header><p class="eyebrow">${e(status[b.status] || b.status)}</p><h1>${e(b.production_title)}</h1><p>${e(b.edition_label)} · ${e(b.original_name || "原文件名已清理")}</p></header>
    <p class="import-summary">${b.add_count} 条${b.committed_at ? "新增关联" : "待新增关联"} · ${b.create_member_count} 份新档案 · ${b.skip_count} 行跳过 · ${b.error_count} 行待处理</p>
    ${b.status === "committed" ? '<p class="notice" role="status">导入完成。重复确认不会再次创建记录。</p>' : ""}${b.status === "rollback_conflict" ? '<p class="notice">安全部分已撤销。有后续修改或引用的记录已保留，请核对下方明细，不会强行删除。</p>' : ""}
    <nav class="import-page-actions" aria-label="导入批次操作">${b.production_id ? `<a href="/productions/${b.production_id}?edition=${b.edition_id || ""}#manage-credits">查看作品名单</a><a href="/admin/productions/${b.production_id}/credits/import">上传另一份表格</a>` : ""}${b.details_purged ? "<span>明细已超过 180 天并清理，不再提供撤销或错误报告。</span>" : `<a href="${url}/errors.csv">下载错误与跳过行报告</a>`}</nav>
    ${editing ? `<div class="import-match-tools"><form method="get" action="${url}" class="import-search"><label>搜索可关联档案<input name="q" maxlength="80" value="${e(search)}" placeholder="输入姓名"></label><button class="secondary">查找档案</button></form><p class="hint">找不到档案时先搜索，再在待处理行中选择。搜索前请保存已经做出的选择。</p></div>` : ""}
    ${review}
    ${editing ? `${members.length ? `<details class="import-candidates"><summary>核对候选档案（最多 100 份，可按姓名缩小范围）</summary><ul>${members.map((m, i) => `<li>候选 ${i + 1}：<a href="/members/${m.id}" target="_blank" rel="noopener" aria-label="${e(m.name)}，${e(m.cohort || "届别未填写")}（新窗口）">${e(m.name)} · ${e(m.cohort || "届别未填写")}</a></li>`).join("")}</ul></details>` : "<p>未找到候选档案，请更换姓名搜索或确认新建。</p>"}` : ""}
    ${b.status === "ready" && !b.details_purged ? `<form class="import-confirm" method="post" action="${url}/confirm">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}"><label><input type="checkbox" name="confirm" value="yes" required>已核对版本、人员和角色，同意新增 ${b.add_count} 条关联及 ${b.create_member_count} 份最小档案</label><p class="hint">全有全无；若数据已变化，将停止提交并要求重新检查。</p><button>确认入库</button></form>` : ""}
    ${["committed", "rollback_conflict"].includes(b.status) && !b.details_purged ? `<details class="import-confirm"><summary>撤销本批导入</summary><p>只移除本批新增且未被修改的关联。新档案有后续修改、账号绑定或其他引用时会保留。</p><form method="post" action="${url}/rollback">${token(csrf)}<input type="hidden" name="revision" value="${b.revision}"><label><input type="checkbox" name="confirm" value="yes" required>确认按安全规则撤销此批次</label><button class="danger">撤销导入</button></form></details>` : ""}
    ${changes.length ? `<details><summary>档案变更明细</summary><ul>${changes.map((c) => `<li><a href="/members/${c.member_id}">查看档案</a> · ${c.change_type === "created" ? "新建" : "补充外部ID"} · ${e(outcomes[c.outcome] || "已应用")}</li>`).join("")}</ul></details>` : ""}
    <details><summary>操作记录</summary><ul>${events.map((v) => `<li>${e(v.created_at)} · ${e(v.actor_name)}：${e(v.summary)}</li>`).join("")}</ul></details>`,
  );
}
