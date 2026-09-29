import type { Bindings } from "../types";
import { usesDirectR2 } from "../storage/r2-s3";
import { uploadPolicy } from "./upload-policy";

// Descriptions only; fields and foreign keys always come from the connected database.
export const tablePurposes: Record<string, string> = {
  member: "队员档案",
  user: "账号、身份与档案绑定",
  email_token: "邮箱验证令牌",
  join_request: "队员认证申请",
  announcement: "公告",
  production: "作品",
  production_edition: "作品演出版本",
  resource: "资料元数据与审核状态",
  member_resource: "队员与资料关联",
  production_credit: "作品演职人员及版本关联",
  flower: "账号献花记录",
  visitor_flower: "访客献花记录",
  site_profile: "网站展示配置",
  upload_task: "上传任务与文件引用",
  upload_part: "分片上传记录",
  production_join_request: "作品加入申请",
  suggestion: "建档与网站建议",
  admin_notification_read: "管理员通知已读状态",
  review_history: "审核历史",
  storage_budget: "应用文件容量台账",
  storage_object: "文件大小台账",
  storage_reservation: "上传容量预留",
  file_cleanup_task: "文件清理任务",
  request_limit: "请求频率限制",
  site_contributor: "贡献者档案",
  contribution_event: "贡献事件",
  website_feedback: "网站反馈",
  credit_import_batch: "演职表导入批次",
  credit_import_row: "导入行与匹配结果",
  credit_import_member_change: "导入档案变更记录",
  credit_import_guard: "导入并发保护",
  credit_import_event: "导入操作历史",
  d1_migrations: "D1 数据库版本记录",
};
type Column = { name: string; type: string; notnull: number; pk: number };
type ForeignKey = { table: string; from: string; to: string; on_delete: string };
type Table = { name: string; purpose: string; columns: Column[]; relations: ForeignKey[] };
type Ledger = {
  initialized: number;
  used_bytes: number;
  reserved_bytes: number;
  updated_at: string;
  cleanup_tasks: number;
};

export async function readSystemInfo(env: Bindings) {
  const schema = async () => {
    const rows = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all<{
      name: string;
    }>();
    const names = rows.results
      .map((row) => row.name)
      .filter((name) => !name.startsWith("sqlite_") && !name.startsWith("_cf_"));
    const tables: Table[] = [];
    // Small read-only batches avoid one binding round trip for every metadata query.
    for (let offset = 0; offset < names.length; offset += 10) {
      const chunk = names.slice(offset, offset + 10);
      const results = await env.DB.batch<Column | ForeignKey>(
        chunk.flatMap((name) => {
          const identifier = '"' + name.replaceAll('"', '""') + '"';
          return [
            env.DB.prepare(`PRAGMA table_info(${identifier})`),
            env.DB.prepare(`PRAGMA foreign_key_list(${identifier})`),
          ];
        }),
      );
      chunk.forEach((name, index) => {
        const columns = results[index * 2].results as Column[];
        const relations = results[index * 2 + 1].results as ForeignKey[];
        tables.push({
          name,
          purpose: tablePurposes[name] ?? "用途暂未确认（当前数据库新增表）",
          columns: columns.map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk })),
          relations: relations.map(({ table, from, to, on_delete }) => ({ table, from, to, on_delete })),
        });
      });
    }
    return tables;
  };
  const [database, ledger, storage] = await Promise.allSettled([
    schema(),
    env.DB.prepare(
      "SELECT initialized,used_bytes,reserved_bytes,updated_at,(SELECT COUNT(*) FROM file_cleanup_task) cleanup_tasks FROM storage_budget WHERE id=1",
    ).first<Ledger>(),
    // Read-only connectivity probe, also used by the existing dependency check. No inventory scan.
    env.FILES.head("__blackbox_connection_check__"),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    environment: env.ENVIRONMENT === "production" ? "生产" : env.ENVIRONMENT === "development" ? "开发" : "未确认",
    bucket: env.R2_BUCKET_NAME || null,
    directUpload: usesDirectR2(env),
    uploadBudgetBytes: uploadPolicy.budgetBytes,
    database:
      database.status === "fulfilled"
        ? { status: "ok" as const, tables: database.value }
        : { status: "error" as const, tables: [] },
    ledger:
      ledger.status === "fulfilled"
        ? { status: "ok" as const, value: ledger.value }
        : { status: "error" as const, value: null },
    storage: storage.status === "fulfilled" ? "ok" : "error",
  };
}
export type SystemInfo = Awaited<ReturnType<typeof readSystemInfo>>;
