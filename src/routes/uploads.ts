import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { csrfValid } from "../http/cookies";
import { createDirectUpload, presignDirectPart, usesDirectR2 } from "../storage/r2-s3";
import { abortDirectUpload } from "../storage/r2-s3";
import { multipartCleanupStatements, drainFileCleanup } from "../services/file-cleanup";
import type { AppEnv } from "../types";
import { consumeAccountLimit } from "../middleware/request-limits";
import { readBoundedBody } from "../http/validation";
import {
  UploadError,
  uploadPolicy,
  validateUpload,
  reserveStorage,
  releaseStorageReservation,
  isVideoUpload,
} from "../services/upload-policy";
import {
  completeUpload,
  cancelUpload,
  getUploadTask,
  assertTaskWritable,
  expectedParts,
  expectedPartSize,
  lockUploadTask,
  unlockUploadTask,
  previewKeyFor,
  type UploadTask,
  type UploadPart,
} from "../services/uploads";

export const uploadRoutes = new Hono<AppEnv>();
uploadRoutes.use("/api/uploads/*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录。" }, 401);
  await next();
});
const csrfOk = (c: Context<AppEnv>) => {
  if (!csrfValid(c, c.req.header("x-csrf-token") ?? null))
    throw new HTTPException(400, { message: "请求已失效，请刷新后重试。" });
};
const safeName = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "resource";
async function jsonBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBody(c.req.raw, 16 * 1024);
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: "上传信息格式不正确。" });
  }
}
async function ownedTask(c: Context<AppEnv>, writable = false): Promise<UploadTask> {
  const task = await getUploadTask(c.env, c.req.param("id")!);
  if (!task || task.user_id !== c.get("user")!.id) throw new HTTPException(404, { message: "上传任务不存在。" });
  if (writable) assertTaskWritable(task);
  return task;
}
uploadRoutes.get("/api/uploads/policy", (c) => c.json(uploadPolicy));
uploadRoutes.post("/api/uploads", async (c) => {
  csrfOk(c);
  const body = await jsonBody(c);
  const title = String(body.title ?? "").trim(),
    original = String(body.originalName ?? "").trim(),
    mime = String(body.contentType ?? "application/octet-stream"),
    resType = String(body.resType ?? "other"),
    description = String(body.description ?? "").trim(),
    size = Number(body.sizeBytes),
    production = body.productionId ? Number(body.productionId) : null;
  if (
    !title ||
    title.length > 100 ||
    !original ||
    original.length > 255 ||
    description.length > 2000 ||
    mime.length > 150
  )
    throw new HTTPException(400, { message: "请检查资料标题、文件名和说明长度。" });
  validateUpload(resType, mime, original, size);
  if (
    production !== null &&
    (!Number.isSafeInteger(production) ||
      production < 1 ||
      !(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(production).first()))
  )
    throw new HTTPException(400, { message: "作品不存在。" });
  const retry = await consumeAccountLimit(c, "upload-create", 120);
  if (retry) {
    c.header("Retry-After", String(retry));
    throw new HTTPException(429, { message: "上传次数较多，请稍后重试。" });
  }
  const id = crypto.randomUUID(),
    key = "resources/" + c.get("user")!.id + "/" + id + "/" + safeName(original),
    mode = usesDirectR2(c.env) ? "direct" : "local",
    reservation = "upload:" + id,
    token = crypto.randomUUID();
  await reserveStorage(c.env, {
    id: reservation,
    bytes: size + uploadPolicy.previewMaxBytes,
    userId: c.get("user")!.id,
    kind: "upload",
  });
  try {
    await c.env.DB.prepare(
      "INSERT INTO upload_task(id,user_id,production_id,object_key,original_name,content_type,size_bytes,status,expires_at,title,res_type,description,upload_mode,lease_token,lease_expires_at) VALUES(?,?,?,?,?,?,?,'uploading',datetime('now','+24 hours'),?,?,?,?,?,datetime('now','+5 minutes'))",
    )
      .bind(id, c.get("user")!.id, production, key, original, mime, size, title, resType, description, mode, token)
      .run();
  } catch (error) {
    await releaseStorageReservation(c.env, reservation);
    throw error;
  }
  let uploadId: string | undefined;
  try {
    uploadId =
      mode === "direct"
        ? await createDirectUpload(c.env, key, mime)
        : (await c.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime } })).uploadId;
    await c.env.DB.prepare(
      "UPDATE upload_task SET multipart_upload_id=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?",
    )
      .bind(uploadId, id, token)
      .run();
  } catch (error) {
    if (uploadId) {
      try {
        await c.env.DB.batch([
          ...multipartCleanupStatements(
            c.env,
            { object_key: key, multipart_upload_id: uploadId, upload_mode: mode },
            reservation,
          ),
          c.env.DB.prepare(
            "UPDATE upload_task SET status='aborted',lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?",
          ).bind(id, token),
        ]);
        await drainFileCleanup(c.env);
      } catch {
        // D1 may still be unavailable. Abort the known, empty multipart directly;
        // the persisted initialization task retains its reservation for cron recovery.
        try {
          if (mode === "direct") await abortDirectUpload(c.env, key, uploadId);
          else await c.env.FILES.resumeMultipartUpload(key, uploadId).abort();
        } catch {}
      }
    }
    await unlockUploadTask(c.env, id, token).catch(() => {});
    throw new HTTPException(502, { message: "上传初始化暂时失败，稍后可重试。" });
  }
  return c.json({ id, partSize: uploadPolicy.partSize, totalParts: expectedParts(size), mode }, 201);
});
uploadRoutes.get("/api/uploads/:id", async (c) => {
  const task = await ownedTask(c);
  if (isVideoUpload(task.res_type, task.content_type, task.original_name))
    throw new UploadError(uploadPolicy.videoNotice, 403);
  const parts = await c.env.DB.prepare(
    "SELECT part_number,etag,size_bytes FROM upload_part WHERE task_id=? ORDER BY part_number",
  )
    .bind(task.id)
    .all<UploadPart>();
  return c.json({
    id: task.id,
    status: task.status,
    partSize: uploadPolicy.partSize,
    totalParts: expectedParts(task.size_bytes),
    parts: parts.results.map((p) => ({ partNumber: p.part_number, etag: p.etag, sizeBytes: p.size_bytes })),
    resourceId: task.resource_id,
    expiresAt: task.expires_at,
    mode: task.upload_mode,
    originalName: task.original_name,
    sizeBytes: task.size_bytes,
    hasPreview: Boolean(task.preview_filename),
  });
});
uploadRoutes.put("/api/uploads/:id/preview", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c, true);
  if (task.res_type !== "photo" || c.req.header("content-type")?.split(";")[0] !== "image/jpeg")
    throw new UploadError("预览图必须是剧照的 JPEG 缩略图。");
  const body = await readBoundedBody(c.req.raw, uploadPolicy.previewMaxBytes);
  if (body.length < 4 || body[0] !== 255 || body[1] !== 216 || body.at(-2) !== 255 || body.at(-1) !== 217)
    throw new UploadError("预览内容不是有效的 JPEG。");
  const token = await lockUploadTask(c.env, task),
    key = previewKeyFor(task);
  try {
    await c.env.FILES.put(key, body, { httpMetadata: { contentType: "image/jpeg" } });
    await c.env.DB.prepare(
      "UPDATE upload_task SET preview_filename=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
    )
      .bind(key, task.id, token)
      .run();
    return c.json({ saved: true });
  } finally {
    await unlockUploadTask(c.env, task.id, token);
  }
});
uploadRoutes.post("/api/uploads/:id/parts/:part/url", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c, true),
    part = Number(c.req.param("part"));
  if (!task.multipart_upload_id || !Number.isSafeInteger(part) || part < 1 || part > expectedParts(task.size_bytes))
    throw new UploadError("分片编号或任务状态无效。");
  if (task.upload_mode === "direct")
    return c.json({
      mode: "direct",
      url: await presignDirectPart(c.env, task.object_key, task.multipart_upload_id, part),
    });
  return c.json({ mode: "local", url: "/api/uploads/" + task.id + "/parts/" + part });
});
uploadRoutes.put("/api/uploads/:id/parts/:part", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c, true),
    part = Number(c.req.param("part"));
  if (
    task.upload_mode !== "local" ||
    !task.multipart_upload_id ||
    !Number.isSafeInteger(part) ||
    part < 1 ||
    part > expectedParts(task.size_bytes) ||
    !c.req.raw.body
  )
    throw new UploadError("分片编号或任务状态无效。");
  const size = expectedPartSize(task, part),
    declared = c.req.header("content-length");
  if (declared !== undefined && Number(declared) !== size) throw new UploadError("分片大小不正确。");
  const token = await lockUploadTask(c.env, task);
  try {
    // FixedLengthStream rejects truncated/oversized bodies without buffering a 50MB part.
    const fixed = new FixedLengthStream(size),
      abort = new AbortController();
    const pipe = c.req.raw.body.pipeTo(fixed.writable, { signal: abort.signal });
    const write = c.env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).uploadPart(
      part,
      fixed.readable,
    );
    const settled = await Promise.allSettled([
      pipe,
      write.catch((error) => {
        abort.abort();
        throw error;
      }),
    ]);
    if (settled[0].status === "rejected") throw new UploadError("分片没有完整上传，请重试。");
    if (settled[1].status === "rejected") throw settled[1].reason;
    const uploaded = settled[1].value;
    await c.env.DB.prepare(
      "INSERT INTO upload_part(task_id,part_number,etag,size_bytes) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM upload_task WHERE id=? AND lease_token=?) ON CONFLICT(task_id,part_number) DO UPDATE SET etag=excluded.etag,size_bytes=excluded.size_bytes",
    )
      .bind(task.id, part, uploaded.etag, size, task.id, token)
      .run();
    return c.json({ etag: uploaded.etag });
  } finally {
    await unlockUploadTask(c.env, task.id, token);
  }
});
uploadRoutes.post("/api/uploads/:id/parts/:part/complete", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c, true),
    part = Number(c.req.param("part")),
    body = await jsonBody(c);
  const etag = String(body.etag ?? "").trim(),
    size = Number(body.sizeBytes);
  if (
    task.upload_mode !== "direct" ||
    !etag ||
    etag.length > 200 ||
    !Number.isSafeInteger(part) ||
    part < 1 ||
    part > expectedParts(task.size_bytes) ||
    size !== expectedPartSize(task, part)
  )
    throw new UploadError("分片结果无效。");
  const token = await lockUploadTask(c.env, task);
  try {
    await c.env.DB.prepare(
      "INSERT INTO upload_part(task_id,part_number,etag,size_bytes) VALUES(?,?,?,?) ON CONFLICT(task_id,part_number) DO UPDATE SET etag=excluded.etag,size_bytes=excluded.size_bytes",
    )
      .bind(task.id, part, etag, size)
      .run();
    return c.json({ saved: true });
  } finally {
    await unlockUploadTask(c.env, task.id, token);
  }
});
uploadRoutes.post("/api/uploads/:id/complete", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c);
  return c.json(await completeUpload(c.env, task.id));
});
uploadRoutes.delete("/api/uploads/:id", async (c) => {
  csrfOk(c);
  const task = await ownedTask(c);
  await cancelUpload(c.env, task.id);
  return c.json({ aborted: true });
});
