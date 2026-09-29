import { escapeHtml as e, layout } from "../views";
import { assetUrl } from "./assets";
import type { SystemInfo } from "../services/system-info";

import { systemSections, systemChapterStart, systemChapterEnd, type SystemSection } from "./system-chapters";
export { systemSections, type SystemSection } from "./system-chapters";
export function systemInfoPage(section: SystemSection = "architecture", flowKey = "upload") {
  const flows = { upload: "资料上传与审核", read: "资料查看与文件读取", member: "队员认证" };
  const selectedFlow = Object.hasOwn(flows, flowKey) ? (flowKey as keyof typeof flows) : "upload";
  const flow = (title: string, steps: string[], source: string) =>
    title !== flows[selectedFlow]
      ? ""
      : `<article class="card flow-document"><h3>${e(title)}</h3><ol class="system-flow">${steps.map((step) => `<li>${e(step)}</li>`).join("")}</ol><p class="muted">代码来源：${e(source)}</p></article>`;
  return layout(
    systemSections[section] + " · 系统信息",
    `<link rel="stylesheet" href="${assetUrl("/system-info.css")}">${systemChapterStart(section)}
    ${
      section === "architecture"
        ? `    <section class="system-console" aria-labelledby="system-map-title">
    <header class="console-head"><div><span class="console-label">只读系统地图 · 代码已确认</span><h2 id="system-map-title">黑匣子的幕后</h2></div><span class="console-chip">2.5D 架构</span></header>
    <div class="console-layout"><div class="scene-column"><div class="scene-toolbar"><label>业务路径<select id="system-path"><option value="all">整体架构</option><option value="upload">资料上传与审核</option><option value="read">资料查看</option><option value="member">队员认证</option></select></label><div><button type="button" data-scene-zoom="in" aria-label="放大系统地图">＋</button><button type="button" data-scene-zoom="out" aria-label="缩小系统地图">−</button><button type="button" id="scene-reset">复位</button></div></div>
    <div id="system-scene" class="system-scene"><p class="scene-fallback">正在准备立体地图。也可用下方模块按钮查看信息。</p></div><p class="scene-caption" id="scene-message" role="status">点击模块查看详情；拖动旋转，滚轮缩放。连接表示代码调用关系，不代表实时流量。</p>
    <div class="scene-nodes" aria-label="系统模块">${[
      ["web", "浏览器"],
      ["assets", "静态资源"],
      ["worker", "Worker"],
      ["db", "D1 数据库"],
      ["r2", "R2 资源桶"],
    ]
      .map(
        ([id, label]) =>
          `<button type="button" data-scene-node="${id}" aria-pressed="${id === "worker"}">${label}</button>`,
      )
      .join("")}</div></div>
    <aside class="node-inspector" aria-label="所选模块详情"><span class="console-label">模块详情</span><h3 id="node-title">Cloudflare Worker</h3><p id="node-description">Hono 处理服务端页面与接口；会话经数据库复核，再检查管理员权限和 CSRF。</p><p class="node-evidence" id="node-evidence">代码来源：src/index.ts、src/middleware/session.ts、src/routes/admin.ts</p><div id="node-live" role="status">实时状态等待查询。</div><a id="node-section" href="#system-report">查看分析报告 →</a></aside></div></section>
    <details id="system-report" class="card system-report"><summary><strong>分析报告与数据来源</strong></summary><p><strong>代码已确认</strong>：TypeScript + Hono 在 Cloudflare Worker 中处理服务端 HTML 与接口；浏览器使用原生 JavaScript 渐进增强。DB 绑定连接 D1，FILES 绑定连接 R2，ASSETS 提供静态资源。</p>
    <p>签名会话经数据库复核账号状态、角色及认证版本；管理员域名入口与后台路由均有权限校验。页面及数据响应禁止缓存。</p>
    <p>主要依赖：hono（路由）、aws4fetch（可选 R2 直传签名）、read-excel-file / fflate（演职表解析）。Turnstile 用于已配置的认证验证，是否启用取决于当前环境配置。</p>
    <p><strong>配置已确认</strong>：wrangler.jsonc 的生产配置使用独立管理员域名、D1 与 R2；开启可观测性及 smart placement；定时任务配置为每小时第 17 分钟，代码负责过期上传、限流记录及导入明细清理。</p>
    <p class="muted">来源：package.json、wrangler.jsonc、src/index.ts、src/middleware/session.ts、src/middleware/admin-portal.ts、src/storage/r2-s3.ts。上述配置不代表已核实线上部署；平台实际部署版本、账单、桶公开访问策略及配额暂未确认。</p></details>
    `
        : ""
    }
    ${
      section === "flows"
        ? `    <section id="system-flows"><h2>选择一条业务路径</h2><nav class="system-flow-switch" aria-label="选择业务流程">${Object.entries(
            flows,
          )
            .map(
              ([key, label]) =>
                `<a href="/admin/system/flows?flow=${key}"${key === selectedFlow ? ' aria-current="page"' : ""}>${label}</a>`,
            )
            .join("")}</nav><p>以下步骤均来自现有业务代码；此面板仅展示，不执行这些操作。</p>
    ${flow("资料上传与审核", ["前端上传表单 → /api/uploads", "会话、CSRF、作品可见性与文件类型/大小校验", "D1：upload_task / upload_part、容量预留", "R2：Worker 分片上传；配置齐全时使用签名直传", "完成校验 → D1 resource；管理员审核接口 → review_history"], "src/routes/uploads.ts、src/services/uploads.ts、src/services/upload-policy.ts、src/routes/resources.ts、src/services/reviews.ts")}
    ${flow("资料查看与文件读取", ["前端资料页 → /resources/:id 及文件读取路由", "查询 D1 resource、作品可见性及资料审核/上传者/管理员权限", "获准后通过 FILES 读取 R2 文件 → 返回内容；公开图片可使用边缘缓存"], "src/routes/resources.ts、src/services/production-visibility.ts、src/services/resource-files.ts")}
    ${flow("队员认证", ["用户提交认证申请 → D1 join_request", "管理员工作台 → /admin/requests/:id/approve 或 reject", "管理员身份与 CSRF 校验 → reviewRequest", "D1 更新申请、账号/档案关联并保存审核历史；不涉及文件存储"], "src/routes/members.ts、src/routes/admin.ts、src/services/reviews.ts")}</section>
    `
        : ""
    }
    ${
      section !== "flows"
        ? `    <section class="system-readout" aria-label="实时信息"><div class="readout-heading"><h2>状态与来源</h2><button type="button" id="system-refresh">刷新只读信息</button></div><p id="system-status" role="status" aria-live="polite">正在加载${section === "database" ? "数据库结构" : section === "storage" ? "存储状态" : "连接状态"}…</p><div id="system-live" data-system-section="${section}" aria-busy="true"></div><noscript><p>请启用 JavaScript 加载实时信息，或<a href="/admin/system/data?section=${section}">直接查看只读查询结果</a>。</p></noscript></section>
    <script src="${assetUrl("/system-info.js")}" defer></script>`
        : ""
    }
    ${systemChapterEnd(section)}
    ${section === "architecture" ? `<script type="module" src="${assetUrl("/system-scene.js")}"></script>` : ""}
    ${section === "database" ? `<script src="${assetUrl("/system-schema.js")}" defer></script>` : ""}
`,
    true,
    true,
  );
}

export function systemInfoSnapshot(info: SystemInfo, section?: SystemSection) {
  const bytes = (value: number) => `${e(value)} 字节`;
  const tables = info.database.tables
    .map(
      (
        table,
      ) => `<details class="card" data-schema-table="${e(table.name)}" data-schema-purpose="${e(table.purpose)}" data-schema-relations="${e(JSON.stringify(table.relations))}"><summary><strong>${e(table.name)}</strong> · ${e(table.purpose)} · ${table.columns.length} 个字段</summary>
    <div class="table-wrap"><table><thead><tr><th>字段</th><th>类型</th><th>约束</th></tr></thead><tbody>${table.columns.map((col) => `<tr><td>${e(col.name)}</td><td>${e(col.type)}</td><td>${col.pk ? `主键（序号 ${col.pk}）` : col.notnull ? "非空" : "可空"}</td></tr>`).join("")}</tbody></table></div>
    <p>已确认关系（实时外键）：</p>${table.relations.length ? `<ul>${table.relations.map((key) => `<li>${e(table.name)}.${e(key.from)} → ${e(key.table)}.${e(key.to || "主键")}；删除行为 ${e(key.on_delete)}</li>`).join("")}</ul>` : "<p>未声明外键；不表示不存在业务关联。</p>"}</details>`,
    )
    .join("");
  const ledger = info.ledger.value;
  return `<div data-system-meta data-table-count="${info.database.tables.length}" data-db-status="${e(info.database.status)}" data-r2-status="${e(info.storage)}" data-bucket="${e(info.bucket || "不可获取")}" data-checked="${e(info.checkedAt)}" hidden></div><p>查询完成时间：<time>${e(info.checkedAt)}</time>（UTC） · 当前环境：${e(info.environment)}</p>
    ${
      !section || section === "database"
        ? `<section id="system-database"><h2>数据库表结构</h2><p>来源：当前 DB 绑定的 sqlite_schema、PRAGMA table_info / foreign_key_list；用途说明来自 migrations 与业务代码。只展示字段定义，不查询业务行或字段默认值。排除 SQLite / Cloudflare 内部表。</p>
    ${info.database.status !== "error" && info.database.tables.length ? `<div class="schema-explorer"><div class="schema-toolbar"><label>查找表<input type="search" id="schema-search" placeholder="表名或用途"></label><label>关系焦点<select id="schema-focus">${info.database.tables.map((t) => `<option value="${e(t.name)}"${t.name === "resource" ? " selected" : ""}>${e(t.name)}</option>`).join("")}</select></label></div><p class="muted">选择一张表查看其直接外键关系；点击图中表名展开字段。连线表示已确认的外键关联；×N 表示同一对表有多条外键。引用字段、方向与删除规则见图下清单。</p><div id="schema-graph" class="schema-graph" aria-label="数据库外键关系图"></div><p id="schema-result" role="status"></p></div>` : ""}
    ${info.database.status === "error" ? '<p role="alert" class="notice">数据库结构查询失败，请稍后刷新重试。</p>' : tables || '<p class="card">当前数据库没有可展示的表。</p>'}
    <p>代码确认的文件关联：resource.filename / preview_filename、upload_task.object_key → FILES 对象；storage_object.object_key 是文件台账键（src/services/uploads.ts、src/services/upload-policy.ts）。这是业务关联，不是数据库外键；未展示未经核实的推断关系。</p></section>
    `
        : ""
    }${
      !section || section === "storage"
        ? `<section id="system-storage" class="card"><h2>资源桶信息</h2><div class="storage-visual" aria-hidden="true"><div class="storage-stack"><i></i><i></i><i></i></div><div><strong>FILES / R2</strong><span>文件存储 · 经业务权限校验访问</span></div></div><p>绑定：FILES（R2）。桶名称配置：${e(info.bucket || "不可获取（未配置 R2_BUCKET_NAME）")}。</p><p>来源：当前环境 R2_BUCKET_NAME；绑定无法自报物理桶名称，配置与实际绑定是否一致尚未独立验证。项目 wrangler.jsonc 配置开发桶 blackbox-files、生产桶 blackbox-files-production。</p>
    <p>用途：资料原文件、预览图、队员头像与网站展示图片。访问方式：业务接口校验后由 Worker 读写；${info.directUpload ? "直传所需配置齐全，上传可使用签名分片 URL" : "直传配置未齐全，使用 Worker 上传"}。不展示对象路径、文件内容或签名 URL。</p>
    <p${info.storage === "error" ? ' role="alert"' : ""}>实时连接检查：${info.storage === "ok" ? "R2 HEAD 请求成功（仅代表连接可用）" : "查询失败，请稍后重试"}。来源：FILES.head；时间同本次查询。</p>
    <dl><dt>平台对象总数</dt><dd>不可获取</dd><dt>平台已用容量</dt><dd>不可获取</dd><dt>平台剩余容量</dt><dd>不可获取</dd><dt>平台容量限额</dt><dd>不可获取（未接入平台配额数据）</dd></dl><p>现有绑定未提供这些汇总数据；本面板不全桶扫描，也不将应用台账当作平台统计。</p>
    <details><summary>应用上传预算与台账（非 R2 实际容量）</summary><p>代码配置的新上传预算：${bytes(info.uploadBudgetBytes)}；来源：src/services/upload-policy.ts。不是 Cloudflare 配额或可用空间。</p>
    ${info.ledger.status === "error" ? '<p role="alert">应用台账查询失败。</p>' : !ledger ? "<p>暂无应用台账数据。</p>" : `<p>初始化核对：${ledger.initialized ? "已完成" : "尚未完成，台账可能不完整"}；记录文件字节：${bytes(ledger.used_bytes)}；预留字节：${bytes(ledger.reserved_bytes)}；待清理任务：${ledger.cleanup_tasks}。</p><p>来源：D1 storage_budget / file_cleanup_task；台账更新时间：${e(ledger.updated_at)} UTC；读取时间同本次查询。台账可能与 R2 不一致，不计算平台剩余容量。</p>`}</details></section>`
        : ""
    }${section === "architecture" ? `<p${info.database.status === "error" || info.storage === "error" ? ' role="alert"' : ""}>${info.database.status === "error" ? "数据库结构查询失败。" : `数据库结构查询成功，共 ${info.database.tables.length} 张表。`} ${info.storage === "ok" ? "R2 连接检查成功。" : "R2 连接检查失败。"} 请选择地图模块查看详情。</p>` : ""}`;
}
