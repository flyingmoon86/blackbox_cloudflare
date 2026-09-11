import type { Bindings } from "../types";
import { completeDirectUpload } from "../storage/r2-s3";
import { UploadError, isVideoUpload, uploadPolicy, ensureStorageBudget } from "./upload-policy";
import { drainFileCleanup, fileCleanupStatements, multipartCleanupStatements } from "./file-cleanup";

export type UploadTask = {
  id: string;
  user_id: number;
  production_id: number | null;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  multipart_upload_id: string | null;
  status: string;
  resource_id: number | null;
  expires_at: string;
  title: string;
  res_type: string;
  description: string;
  upload_mode: "local" | "direct";
  preview_filename: string;
  lease_token: string | null;
  lease_expires_at: string | null;
};
export type UploadPart = { part_number: number; etag: string; size_bytes: number };
export const expectedParts = (size: number): number => Math.ceil(size / uploadPolicy.partSize);
export const expectedPartSize = (task: UploadTask, part: number): number =>
  part < expectedParts(task.size_bytes) ? uploadPolicy.partSize : task.size_bytes - uploadPolicy.partSize * (part - 1);
export const taskExpired = (task: UploadTask): boolean =>
  Date.parse(`${task.expires_at.replace(" ", "T").replace(/Z$/, "")}Z`) <= Date.now();
export const previewKeyFor = (task: UploadTask): string => task.preview_filename || `${task.object_key}.preview.jpg`;
export const getUploadTask = (env: Bindings, id: string): Promise<UploadTask | null> =>
  env.DB.prepare("SELECT * FROM upload_task WHERE id=?").bind(id).first<UploadTask>();

export function assertTaskWritable(task: UploadTask): void {
  if (isVideoUpload(task.res_type, task.content_type, task.original_name))
    throw new UploadError(uploadPolicy.videoNotice, 403);
  if (taskExpired(task)) throw new UploadError("上传任务已过期，请重新选择文件上传。", 410);
  if (task.status !== "uploading") throw new UploadError("上传任务正在完成或已结束。", 409);
}

export async function lockUploadTask(env: Bindings, task: UploadTask, completing = false): Promise<string> {
  const token = crypto.randomUUID();
  const locked = await env.DB.prepare(
    `UPDATE upload_task SET lease_token=?,lease_expires_at=datetime('now','+5 minutes'),status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP) AND ${completing ? "((status='uploading' AND expires_at>CURRENT_TIMESTAMP) OR status='completing')" : "status='uploading' AND expires_at>CURRENT_TIMESTAMP"}`,
  )
    .bind(token, completing ? "completing" : "uploading", task.id)
    .run();
  if (locked.meta.changes !== 1) throw new UploadError("上传任务正在处理中，请稍后重试。", 409);
  return token;
}
export async function unlockUploadTask(env: Bindings, id: string, token: string): Promise<void> {
  await env.DB.prepare("UPDATE upload_task SET lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?")
    .bind(id, token)
    .run();
}

async function checkObjectContent(env: Bindings, task: UploadTask): Promise<void> {
  const object = await env.FILES.get(task.object_key, { range: { offset: 0, length: 512 } });
  if (!object) throw new UploadError("文件尚未完整保存，可以稍后重试。", 502);
  const bytes = new Uint8Array(await object.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const webp = text.startsWith("RIFF") && text.slice(8, 12) === "WEBP";
  const avif = text.slice(4, 8) === "ftyp" && /avif|avis/.test(text.slice(8, 40));
  const video =
    (text.slice(4, 8) === "ftyp" && !avif && !/M4A |M4B /.test(text.slice(8, 16))) ||
    (text.startsWith("RIFF") && text.slice(8, 12) === "AVI ") ||
    (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) ||
    text.startsWith("FLV");
  if (video) throw new UploadError(uploadPolicy.videoNotice, 403);
  if (task.res_type === "photo" && !jpeg && !png && !webp && !avif)
    throw new UploadError("剧照内容不是支持的 JPEG、PNG、WebP 或 AVIF 图片。", 400);
  if (/\.pdf$/i.test(task.original_name) && !text.startsWith("%PDF-"))
    throw new UploadError("文件内容不是有效的 PDF。", 400);
}

async function completedResult(env: Bindings, task: UploadTask): Promise<{ resourceId: number; status: string }> {
  const resource = await env.DB.prepare(
    "SELECT id,status FROM resource WHERE id=? OR source_upload_task_id=? ORDER BY id LIMIT 1",
  )
    .bind(task.resource_id, task.id)
    .first<{ id: number; status: string }>();
  if (!resource) throw new UploadError("该资料已提交，随后已被删除，请勿重复上传。", 410);
  return { resourceId: resource.id, status: resource.status };
}

/** Recoverable state machine: an already merged R2 object skips multipart completion.
 * The resource insert, reservation transfer and final task state commit atomically in D1.
 */
export async function completeUpload(env: Bindings, id: string): Promise<{ resourceId: number; status: string }> {
  await ensureStorageBudget(env);
  let task = await getUploadTask(env, id);
  if (!task) throw new UploadError("上传任务不存在。", 404);
  if (task.status === "completed") return completedResult(env, task);
  if (isVideoUpload(task.res_type, task.content_type, task.original_name))
    throw new UploadError(uploadPolicy.videoNotice, 403);
  if (task.status !== "uploading" && task.status !== "completing") throw new UploadError("上传任务已结束。", 410);
  if (task.status === "uploading" && taskExpired(task)) throw new UploadError("上传任务已过期，请重新上传。", 410);
  const token = await lockUploadTask(env, task, true);
  try {
    let object = await env.FILES.head(task.object_key);
    if (!object) {
      const rows = await env.DB.prepare(
        "SELECT part_number,etag,size_bytes FROM upload_part WHERE task_id=? ORDER BY part_number",
      )
        .bind(task.id)
        .all<UploadPart>();
      if (
        rows.results.length !== expectedParts(task.size_bytes) ||
        rows.results.some(
          (part, index) =>
            part.part_number !== index + 1 || part.size_bytes !== expectedPartSize(task!, part.part_number),
        )
      ) {
        // No R2 merge has happened: allow the client to send the missing parts.
        await env.DB.prepare("UPDATE upload_task SET status='uploading' WHERE id=? AND lease_token=?")
          .bind(id, token)
          .run();
        throw new UploadError("仍有分片未上传完成。", 409);
      }
      if (!task.multipart_upload_id) throw new UploadError("上传初始化未完成，请取消此任务后重新上传。", 409);
      const parts = rows.results.map((part) => ({ partNumber: part.part_number, etag: part.etag }));
      try {
        if (task.upload_mode === "direct")
          await completeDirectUpload(env, task.object_key, task.multipart_upload_id, parts);
        else await env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).complete(parts);
      } catch (error) {
        // A response may be lost after R2 has already committed the object.
        object = await env.FILES.head(task.object_key);
        if (!object) {
          // No object was merged: allow repairing parts or canceling instead of
          // leaving the user permanently stuck in the completing state.
          await env.DB.prepare("UPDATE upload_task SET status='uploading' WHERE id=? AND lease_token=?")
            .bind(id, token)
            .run();
          throw error;
        }
      }
      object ??= await env.FILES.head(task.object_key);
    }
    if (!object) throw new UploadError("合并结果暂不可用，请稍后重试。", 502);
    try {
      if (object.size !== task.size_bytes) throw new UploadError("实际文件大小与上传声明不一致，请重新上传。", 400);
      await checkObjectContent(env, task);
      if (
        !(await env.DB.prepare("SELECT id FROM user WHERE id=? AND status='active' AND role IN ('member','admin')")
          .bind(task.user_id)
          .first())
      )
        throw new UploadError("账号已失去上传权限。", 403);
    } catch (error) {
      if (!(error instanceof UploadError) || error.status === 502) throw error;
      await env.DB.batch([
        ...fileCleanupStatements(env, [task.object_key, previewKeyFor(task)], `upload:${id}`),
        env.DB.prepare(
          "UPDATE upload_task SET status='aborted',updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
        ).bind(id, token),
      ]);
      await drainFileCleanup(env).catch((reason) =>
        console.error(JSON.stringify({ event: "rejected_file_cleanup_retry" })),
      );
      throw error;
    }
    const preview = await env.FILES.head(previewKeyFor(task));
    const reservation = `upload:${id}`;
    const guard = "EXISTS(SELECT 1 FROM upload_task t WHERE t.id=? AND t.lease_token=?)";
    const committed =
      "EXISTS(SELECT 1 FROM upload_task t JOIN resource r ON r.source_upload_task_id=t.id WHERE t.id=? AND t.lease_token=?)";
    const legacy = await env.DB.prepare(
      "SELECT id FROM resource WHERE filename=? AND source_upload_task_id IS NULL ORDER BY id LIMIT 1",
    )
      .bind(task.object_key)
      .first<{ id: number }>();
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE resource SET source_upload_task_id=? WHERE id=? AND source_upload_task_id IS NULL AND ${guard}`,
      ).bind(id, legacy?.id ?? null, id, token),
      env.DB.prepare(
        `INSERT INTO resource(production_id,status,uploader_id,title,res_type,description,filename,original_name,preview_filename,source_upload_task_id) SELECT t.production_id,CASE WHEN u.role='admin' AND u.status='active' THEN 'approved' ELSE 'pending' END,t.user_id,t.title,t.res_type,t.description,t.object_key,t.original_name,?,t.id FROM upload_task t JOIN user u ON u.id=t.user_id WHERE t.id=? AND t.lease_token=? AND u.status='active' AND u.role IN ('member','admin') AND NOT EXISTS(SELECT 1 FROM resource WHERE source_upload_task_id=t.id) ON CONFLICT DO NOTHING`,
      ).bind(preview ? preview.key : "", id, token),
      env.DB.prepare(`DELETE FROM storage_reservation WHERE id=? AND ${committed}`).bind(reservation, id, token),
      env.DB.prepare(
        `INSERT INTO storage_object(object_key,size_bytes) SELECT ?,? WHERE ${committed} ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes`,
      ).bind(task.object_key, object.size, id, token),
      ...(preview
        ? [
            env.DB.prepare(
              `INSERT INTO storage_object(object_key,size_bytes) SELECT ?,? WHERE ${committed} ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes`,
            ).bind(preview.key, preview.size, id, token),
          ]
        : []),
      env.DB.prepare(
        "UPDATE upload_task SET status='completed',resource_id=(SELECT id FROM resource WHERE source_upload_task_id=?),preview_filename=?,lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=? AND EXISTS(SELECT 1 FROM resource WHERE source_upload_task_id=?)",
      ).bind(id, preview ? preview.key : "", id, token, id),
    ]);
    task = await getUploadTask(env, id);
    if (!task || task.status !== "completed") throw new UploadError("上传状态已变化，请重试确认结果。", 409);
    return completedResult(env, task);
  } finally {
    await unlockUploadTask(env, id, token);
  }
}

export async function cancelUpload(env: Bindings, id: string, expired = false): Promise<void> {
  const task = await getUploadTask(env, id);
  if (!task) throw new UploadError("上传任务不存在。", 404);
  if (task.status === "aborted" || task.status === "expired") return;
  if (task.status !== "uploading") throw new UploadError("文件正在完成或已提交，不能取消。", 409);
  if (await env.DB.prepare("SELECT id FROM resource WHERE filename=? LIMIT 1").bind(task.object_key).first()) {
    await env.DB.prepare("UPDATE upload_task SET status='completing' WHERE id=? AND status='uploading'").bind(id).run();
    throw new UploadError("此任务已有资料记录，正在恢复提交结果，请稍后查看。", 409);
  }
  const token = crypto.randomUUID();
  const locked = await env.DB.prepare(
    "UPDATE upload_task SET lease_token=?,lease_expires_at=datetime('now','+5 minutes') WHERE id=? AND status='uploading' AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP)",
  )
    .bind(token, id)
    .run();
  if (locked.meta.changes !== 1) throw new UploadError("文件正在处理中，请稍后取消。", 409);
  try {
    await env.DB.batch([
      ...multipartCleanupStatements(env, task, `upload:${id}`),
      ...fileCleanupStatements(env, [previewKeyFor(task)], `upload:${id}`),
      env.DB.prepare(
        "UPDATE upload_task SET status=?,lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
      ).bind(expired ? "expired" : "aborted", id, token),
    ]);
  } finally {
    await unlockUploadTask(env, id, token);
  }
  await drainFileCleanup(env).catch((error) =>
    console.error(JSON.stringify({ event: "cancel_cleanup_retry", taskId: id })),
  );
}
