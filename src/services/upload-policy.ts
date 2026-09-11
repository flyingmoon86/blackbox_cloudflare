import type { Bindings } from "../types";
import { HTTPException } from "hono/http-exception";

export const uploadPolicy = {
  videoEnabled: false,
  videoNotice: "测试阶段不支持视频",
  videoExtensions: [
    "mp4",
    "m4v",
    "mov",
    "webm",
    "mkv",
    "avi",
    "wmv",
    "flv",
    "mpeg",
    "mpg",
    "3gp",
    "ts",
    "mts",
    "m2ts",
    "ogv",
  ],
  limits: { photo: 20 * 1024 * 1024, script: 50 * 1024 * 1024, audio: 100 * 1024 * 1024, other: 100 * 1024 * 1024 },
  partSize: 50 * 1024 * 1024,
  previewMaxBytes: 1_500_000,
  maxConcurrentTasks: 3,
  budgetBytes: 9_000_000_000,
} as const;

export class UploadError extends HTTPException {
  constructor(message: string, status: 400 | 403 | 404 | 409 | 410 | 413 | 429 | 502 | 503 = 400) {
    super(status, { message });
  }
}

export const isVideoUpload = (type: string, mime: string, name: string): boolean =>
  type === "video" ||
  mime.toLowerCase().startsWith("video/") ||
  (uploadPolicy.videoExtensions as readonly string[]).includes(name.toLowerCase().split(".").pop() ?? "");

export function validateUpload(type: string, mime: string, name: string, size: number): void {
  if (isVideoUpload(type, mime, name)) throw new UploadError(uploadPolicy.videoNotice, 403);
  const maximum = uploadPolicy.limits[type as keyof typeof uploadPolicy.limits];
  if (!maximum || !Number.isSafeInteger(size) || size < 1) throw new UploadError("资料类型或文件大小不正确。");
  if (size > maximum) throw new UploadError(`此类资料单个文件上限为 ${maximum / 1024 / 1024}MB。`, 413);
}

type Budget = { initialized: number; scan_cursor: string | null };

/** First-run inventory includes every existing R2 key, not only resources indexed by D1.
 * Writes stay closed while pages are being counted; expired leases resume at the saved cursor.
 */
export async function ensureStorageBudget(env: Bindings): Promise<void> {
  const budget = await env.DB.prepare("SELECT initialized,scan_cursor FROM storage_budget WHERE id=1").first<Budget>();
  if (budget?.initialized) return;
  const token = crypto.randomUUID();
  const locked = await env.DB.prepare(
    "UPDATE storage_budget SET scan_token=?,scan_expires_at=datetime('now','+5 minutes') WHERE id=1 AND initialized=0 AND (scan_token IS NULL OR scan_expires_at<CURRENT_TIMESTAMP)",
  )
    .bind(token)
    .run();
  if (locked.meta.changes !== 1) throw new UploadError("正在核对已有文件空间，请稍后重试上传。", 503);
  try {
    let cursor =
      (await env.DB.prepare("SELECT scan_cursor FROM storage_budget WHERE id=1").first<Budget>())?.scan_cursor ??
      undefined;
    for (let page = 0; page < 2; page += 1) {
      const objects = await env.FILES.list({ limit: 200, ...(cursor ? { cursor } : {}) });
      const statements = objects.objects.map((object) =>
        env.DB.prepare(
          "INSERT INTO storage_object(object_key,size_bytes) VALUES(?,?) ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes",
        ).bind(object.key, object.size),
      );
      // Each small batch remains below D1's parameter/statement limits.
      for (let offset = 0; offset < statements.length; offset += 50)
        await env.DB.batch(statements.slice(offset, offset + 50));
      if (!objects.truncated) {
        await env.DB.batch([
          env.DB.prepare(
            "INSERT OR IGNORE INTO storage_reservation(id,user_id,kind,size_bytes,expires_at) SELECT 'upload:'||id,user_id,'upload',size_bytes+?,expires_at FROM upload_task WHERE status IN ('uploading','completing')",
          ).bind(uploadPolicy.previewMaxBytes),
          env.DB.prepare(
            "UPDATE storage_budget SET initialized=1,scan_cursor=NULL,scan_token=NULL,scan_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND scan_token=?",
          ).bind(token),
        ]);
        return;
      }
      cursor = objects.cursor;
      await env.DB.prepare(
        "UPDATE storage_budget SET scan_cursor=?,scan_expires_at=datetime('now','+5 minutes') WHERE id=1 AND scan_token=?",
      )
        .bind(cursor, token)
        .run();
    }
  } finally {
    await env.DB.prepare("UPDATE storage_budget SET scan_token=NULL,scan_expires_at=NULL WHERE id=1 AND scan_token=?")
      .bind(token)
      .run();
  }
  throw new UploadError("正在分批核对已有文件空间，请稍后重试上传。", 503);
}

export async function reserveStorage(
  env: Bindings,
  reservation: { id: string; bytes: number; userId?: number; kind?: "upload" | "avatar" },
): Promise<void> {
  if (!Number.isSafeInteger(reservation.bytes) || reservation.bytes < 1) throw new UploadError("存储预留大小无效。");
  await ensureStorageBudget(env);
  try {
    await env.DB.prepare("INSERT INTO storage_reservation(id,user_id,kind,size_bytes) VALUES(?,?,?,?)")
      .bind(reservation.id, reservation.userId ?? null, reservation.kind ?? "avatar", reservation.bytes)
      .run();
  } catch (error) {
    const message = String(error);
    if (message.includes("STORAGE_BUDGET_EXCEEDED"))
      throw new UploadError("网站文件空间已接近 9GB，暂时停止新上传，请联系管理员。", 413);
    if (message.includes("UPLOAD_CONCURRENCY_EXCEEDED"))
      throw new UploadError("最多同时保留 3 个上传任务，请先完成或取消已有任务。", 429);
    throw error;
  }
}

export function storageCommitStatements(
  env: Bindings,
  reservationId: string,
  objects: readonly { key: string; size: number }[],
): D1PreparedStatement[] {
  return [
    env.DB.prepare("DELETE FROM storage_reservation WHERE id=?").bind(reservationId),
    ...objects.map((object) =>
      env.DB.prepare(
        "INSERT INTO storage_object(object_key,size_bytes) VALUES(?,?) ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes",
      ).bind(object.key, object.size),
    ),
  ];
}

export async function releaseStorageReservation(env: Bindings, reservationId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM storage_reservation WHERE id=?").bind(reservationId).run();
}
