import { Hono } from "hono";
import type { AppEnv } from "../types";
import { layout, escapeHtml } from "../views";
import { consumeAccountLimit } from "../middleware/request-limits";
export const operationsRoutes = new Hono<AppEnv>();
operationsRoutes.use("/admin/*", async (c, next) => {
  if (!c.get("user")) return c.redirect("/login?next=" + encodeURIComponent(c.req.path));
  if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
  await next();
});
operationsRoutes.get("/admin/review-history", async (c) => {
  const before = Number(c.req.query("before") || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before) || before < 1) return c.text("分页编号无效。", 400);
  const rows = await c.env.DB.prepare(
    "SELECT h.id,h.entity_type,h.entity_id,h.decision,h.note,h.reviewed_at,u.username FROM review_history h LEFT JOIN user u ON u.id=h.actor_id WHERE h.id<? ORDER BY h.id DESC LIMIT 51",
  )
    .bind(before)
    .all<{
      id: number;
      entity_type: string;
      entity_id: number;
      decision: string;
      note: string;
      reviewed_at: string;
      username: string | null;
    }>();
  const visible = rows.results.slice(0, 50),
    labels: Record<string, string> = { member: "队员认证", "production-join": "作品加入", resource: "资料" };
  const cards = visible
    .map(
      (row) =>
        '<article class="card"><h2>' +
        escapeHtml(labels[row.entity_type]) +
        " #" +
        row.entity_id +
        " · " +
        (row.decision === "approved" ? "通过" : "驳回") +
        "</h2><p>" +
        escapeHtml(row.username || "已删除的管理员") +
        " · " +
        escapeHtml(row.reviewed_at) +
        " UTC</p><p>" +
        escapeHtml(row.note || "无补充说明") +
        "</p></article>",
    )
    .join("");
  return c.html(
    layout(
      "审核历史",
      '<p><a href="/admin">← 管理员工作台</a></p><h1>审核历史</h1><p>记录启用本功能后的审核操作；历史资料原有状态保持不变。</p>' +
        cards +
        (visible.length ? "" : '<p class="card">暂无审核历史。</p>') +
        (rows.results.length > 50 ? '<p><a href="?before=' + visible.at(-1)!.id + '">更早记录 →</a></p>' : ""),
      true,
      true,
    ),
  );
});
operationsRoutes.get("/admin/system", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT initialized,used_bytes,reserved_bytes,(SELECT COUNT(*) FROM file_cleanup_task) cleanup_tasks FROM storage_budget WHERE id=1",
  ).first<{ initialized: number; used_bytes: number; reserved_bytes: number; cleanup_tasks: number }>();
  const gb = (bytes: number) => (bytes / 1e9).toFixed(3) + " GB";
  return c.html(
    layout(
      "存储状态",
      '<p><a href="/admin">← 管理员工作台</a></p><section class="card"><h1>存储与服务状态</h1><p>文件容量核对：' +
        (row?.initialized ? "已完成" : "等待后台核对；暂不接受新上传") +
        "</p><p>已存文件：" +
        gb(row?.used_bytes || 0) +
        "；上传预留：" +
        gb(row?.reserved_bytes || 0) +
        "</p><p>新上传容量上限：9 GB。待清理文件：" +
        (row?.cleanup_tasks || 0) +
        ' 个。</p><p>这里显示网站的文件台账；实际账单和操作次数请以 Cloudflare 控制台为准。</p><a class="button" href="/admin/system/check">检查数据库与文件存储连接</a></section>',
      true,
      true,
    ),
  );
});
operationsRoutes.get("/admin/system/check", async (c) => {
  const retry = await consumeAccountLimit(c, "dependency-check", 6, 60);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.json({ error: "请稍后再次检查。" }, 429);
  }
  await c.env.DB.prepare("SELECT 1").first();
  await c.env.FILES.head("__blackbox_connection_check__");
  return c.json({ ok: true, database: "reachable", files: "reachable" });
});
