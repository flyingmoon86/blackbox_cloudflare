import { Hono } from "hono";
import { csrfValid } from "../http/cookies";
import {
  abortDirectUpload,
  completeDirectUpload,
  createDirectUpload,
  presignDirectPart,
  usesDirectR2,
} from "../storage/r2-s3";
import type { AppEnv } from "../types";

const PART_SIZE = 50 * 1024 * 1024;
const MAX_SIZE = 10 * 1024 * 1024 * 1024;
const VIDEO_NOTICE = "测试阶段不支持视频";
const isVideoUpload = (type: string, mime: string, name: string): boolean =>
  type === "video" ||
  mime.toLowerCase().startsWith("video/") ||
  /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|ts|mts|m2ts|ogv)$/i.test(name);
const TYPES = new Set(["video", "script", "photo", "audio", "other"]);

type Task = {
  id: string;
  user_id: number;
  production_id: number | null;
  object_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  multipart_upload_id: string;
  status: string;
  resource_id: number | null;
  expires_at: string;
  title: string;
  res_type: string;
  description: string;
  upload_mode: "local" | "direct";
  preview_filename: string;
};
type Part = { part_number: number; etag: string; size_bytes: number };

export const uploadRoutes = new Hono<AppEnv>();
uploadRoutes.use("/api/uploads/*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录。" }, 401);
  if (user.role === "user") return c.json({ error: "认证队员或管理员才能上传资料。" }, 403);
  await next();
});

const csrfOk = (c: any): boolean => csrfValid(c, c.req.header("x-csrf-token") ?? null);
const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180) || "resource";
const expectedParts = (size: number): number => Math.ceil(size / PART_SIZE);
const expectedPartSize = (task: Task, number: number): number =>
  number < expectedParts(task.size_bytes) ? PART_SIZE : task.size_bytes - PART_SIZE * (number - 1);

async function ownedTask(c: any): Promise<Task | null> {
  const task = (await c.env.DB.prepare("SELECT * FROM upload_task WHERE id=?")
    .bind(c.req.param("id"))
    .first()) as Task | null;
  if (!task || task.user_id !== c.get("user").id) return null;
  return task;
}

uploadRoutes.post("/api/uploads", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效，请刷新页面后重试。" }, 400);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "上传信息格式不正确。" }, 400);
  }
  const title = String(body.title ?? "").trim(),
    original = String(body.originalName ?? "").trim(),
    contentType = String(body.contentType ?? "application/octet-stream").slice(0, 150),
    resType = String(body.resType ?? "other"),
    description = String(body.description ?? "").trim(),
    size = Number(body.sizeBytes),
    production = body.productionId ? Number(body.productionId) : null;
  if (isVideoUpload(resType, contentType, original)) return c.json({ error: VIDEO_NOTICE }, 403);
  if (
    !title ||
    title.length > 100 ||
    !original ||
    original.length > 255 ||
    description.length > 2000 ||
    !TYPES.has(resType) ||
    !Number.isInteger(size) ||
    size < 1 ||
    size > MAX_SIZE
  )
    return c.json({ error: "请检查资料信息；单个文件上限为 10GB。" }, 400);
  if (production !== null && !(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(production).first()))
    return c.json({ error: "作品不存在。" }, 400);
  const id = crypto.randomUUID(),
    key = `resources/${c.get("user")!.id}/${id}/${safeName(original)}`,
    mode = usesDirectR2(c.env) ? "direct" : "local";
  let multipart: R2MultipartUpload | string;
  try {
    multipart =
      mode === "direct"
        ? await createDirectUpload(c.env, key, contentType)
        : await c.env.FILES.createMultipartUpload(key, { httpMetadata: { contentType } });
  } catch (error) {
    console.error(error);
    return c.json({ error: "暂时无法创建上传任务。" }, 502);
  }
  const uploadId = typeof multipart === "string" ? multipart : multipart.uploadId;
  try {
    await c.env.DB.prepare(
      `INSERT INTO upload_task(id,user_id,production_id,object_key,original_name,content_type,size_bytes,multipart_upload_id,status,expires_at,title,res_type,description,upload_mode) VALUES(?,?,?,?,?,?,?,?,'uploading',datetime('now','+24 hours'),?,?,?,?)`,
    )
      .bind(
        id,
        c.get("user")!.id,
        production,
        key,
        original,
        contentType,
        size,
        uploadId,
        title,
        resType,
        description,
        mode,
      )
      .run();
  } catch (error) {
    console.error(error);
    try {
      if (mode === "direct") await abortDirectUpload(c.env, key, uploadId);
      else await c.env.FILES.resumeMultipartUpload(key, uploadId).abort();
    } catch {}
    return c.json({ error: "无法保存上传任务。" }, 500);
  }
  return c.json({ id, partSize: PART_SIZE, totalParts: expectedParts(size), mode }, 201);
});

uploadRoutes.get("/api/uploads/:id", async (c) => {
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task) return c.json({ error: "上传任务不存在。" }, 404);
  const parts = await c.env.DB.prepare(
    "SELECT part_number,etag,size_bytes FROM upload_part WHERE task_id=? ORDER BY part_number",
  )
    .bind(task.id)
    .all<Part>();
  return c.json({
    id: task.id,
    status: task.status,
    partSize: PART_SIZE,
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
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading") return c.json({ error: "上传任务不存在或不能继续。" }, 404);
  if (task.res_type !== "photo" && task.res_type !== "video") return c.json({ error: "这种资料不需要图片预览。" }, 400);
  const declaredSize = c.req.header("content-length") ? Number(c.req.header("content-length")) : null;
  if (declaredSize !== null && (!Number.isInteger(declaredSize) || declaredSize < 1 || declaredSize > 1_500_000))
    return c.json({ error: "预览图大小不正确。" }, 400);
  const contentType = c.req.header("content-type")?.split(";", 1)[0];
  if (contentType !== "image/jpeg") return c.json({ error: "预览图必须是 JPEG。" }, 400);
  const body = await c.req.arrayBuffer();
  if (body.byteLength < 1 || body.byteLength > 1_500_000 || (declaredSize !== null && body.byteLength !== declaredSize))
    return c.json({ error: "预览图没有完整上传。" }, 400);
  const signature = new Uint8Array(body);
  if (
    signature.length < 4 ||
    signature[0] !== 0xff ||
    signature[1] !== 0xd8 ||
    signature.at(-2) !== 0xff ||
    signature.at(-1) !== 0xd9
  )
    return c.json({ error: "预览图内容不是有效的 JPEG。" }, 400);
  const previewKey = `${task.object_key}.preview.jpg`;
  try {
    await c.env.FILES.put(previewKey, body, { httpMetadata: { contentType: "image/jpeg" } });
    await c.env.DB.prepare("UPDATE upload_task SET preview_filename=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(previewKey, task.id)
      .run();
    return c.json({ saved: true });
  } catch (error) {
    console.error(error);
    await c.env.FILES.delete(previewKey).catch(() => {});
    return c.json({ error: "预览图保存失败，资料仍可继续上传。" }, 502);
  }
});

uploadRoutes.post("/api/uploads/:id/parts/:part/url", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading") return c.json({ error: "上传任务不存在或不能继续。" }, 404);
  const part = Number(c.req.param("part"));
  if (!Number.isInteger(part) || part < 1 || part > expectedParts(task.size_bytes))
    return c.json({ error: "分片编号无效。" }, 400);
  if (task.upload_mode === "direct") {
    const url = await presignDirectPart(c.env, task.object_key, task.multipart_upload_id, part);
    return c.json({ mode: "direct", url });
  }
  return c.json({ mode: "local", url: `/api/uploads/${task.id}/parts/${part}` });
});

uploadRoutes.put("/api/uploads/:id/parts/:part", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading" || task.upload_mode !== "local")
    return c.json({ error: "本地上传任务不存在或不能继续。" }, 404);
  const part = Number(c.req.param("part"));
  const size = Number(c.req.header("content-length"));
  if (
    !Number.isInteger(part) ||
    part < 1 ||
    part > expectedParts(task.size_bytes) ||
    size !== expectedPartSize(task, part) ||
    !c.req.raw.body
  )
    return c.json({ error: "分片编号或大小不正确。" }, 400);
  try {
    const uploaded = await c.env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).uploadPart(
      part,
      c.req.raw.body,
    );
    await c.env.DB.prepare(
      "INSERT INTO upload_part(task_id,part_number,etag,size_bytes) VALUES(?,?,?,?) ON CONFLICT(task_id,part_number) DO UPDATE SET etag=excluded.etag,size_bytes=excluded.size_bytes",
    )
      .bind(task.id, part, uploaded.etag, size)
      .run();
    return c.json({ etag: uploaded.etag });
  } catch (error) {
    console.error(error);
    return c.json({ error: "分片上传失败，可以重试。" }, 502);
  }
});

uploadRoutes.post("/api/uploads/:id/parts/:part/complete", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading" || task.upload_mode !== "direct")
    return c.json({ error: "直传任务不存在或不能继续。" }, 404);
  const part = Number(c.req.param("part"));
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "分片结果格式错误。" }, 400);
  }
  const etag = String(body.etag ?? "").trim(),
    size = Number(body.sizeBytes);
  if (
    !etag ||
    etag.length > 200 ||
    !Number.isInteger(part) ||
    part < 1 ||
    part > expectedParts(task.size_bytes) ||
    size !== expectedPartSize(task, part)
  )
    return c.json({ error: "分片结果无效。" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO upload_part(task_id,part_number,etag,size_bytes) VALUES(?,?,?,?) ON CONFLICT(task_id,part_number) DO UPDATE SET etag=excluded.etag,size_bytes=excluded.size_bytes",
  )
    .bind(task.id, part, etag, size)
    .run();
  return c.json({ saved: true });
});

uploadRoutes.post("/api/uploads/:id/complete", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading") return c.json({ error: "上传任务不存在或不能完成。" }, 404);
  const rows = await c.env.DB.prepare(
    "SELECT part_number,etag,size_bytes FROM upload_part WHERE task_id=? ORDER BY part_number",
  )
    .bind(task.id)
    .all<Part>();
  if (
    rows.results.length !== expectedParts(task.size_bytes) ||
    rows.results.reduce((n, p) => n + p.size_bytes, 0) !== task.size_bytes
  )
    return c.json({ error: "仍有分片未上传完成。" }, 409);
  const locked = await c.env.DB.prepare(
    "UPDATE upload_task SET status='completing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='uploading'",
  )
    .bind(task.id)
    .run();
  if (locked.meta.changes !== 1) return c.json({ error: "上传任务状态已变化。" }, 409);
  try {
    const parts = rows.results.map((p) => ({ partNumber: p.part_number, etag: p.etag }));
    if (task.upload_mode === "direct")
      await completeDirectUpload(c.env, task.object_key, task.multipart_upload_id, parts);
    else await c.env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).complete(parts);
    const status = c.get("user")!.role === "admin" ? "approved" : "pending";
    const resource = await c.env.DB.prepare(
      "INSERT INTO resource(production_id,status,uploader_id,title,res_type,description,filename,original_name,preview_filename) VALUES(?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        task.production_id,
        status,
        task.user_id,
        task.title,
        task.res_type,
        task.description,
        task.object_key,
        task.original_name,
        task.preview_filename,
      )
      .run();
    await c.env.DB.prepare(
      "UPDATE upload_task SET status='completed',resource_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    )
      .bind(resource.meta.last_row_id, task.id)
      .run();
    return c.json({ resourceId: resource.meta.last_row_id, status });
  } catch (error) {
    console.error(error);
    await c.env.DB.prepare(
      "UPDATE upload_task SET status='uploading',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='completing'",
    )
      .bind(task.id)
      .run();
    return c.json({ error: "合并文件失败，可以稍后重试。" }, 502);
  }
});

uploadRoutes.delete("/api/uploads/:id", async (c) => {
  if (!csrfOk(c)) return c.json({ error: "请求已失效。" }, 400);
  const task = await ownedTask(c);
  if (task && c.req.method !== "DELETE" && isVideoUpload(task.res_type, task.content_type, task.original_name))
    return c.json({ error: VIDEO_NOTICE }, 403);
  if (!task || task.status !== "uploading") return c.json({ error: "上传任务不存在或不能取消。" }, 404);
  try {
    if (task.upload_mode === "direct") await abortDirectUpload(c.env, task.object_key, task.multipart_upload_id);
    else await c.env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).abort();
    if (task.preview_filename) await c.env.FILES.delete(task.preview_filename);
    await c.env.DB.prepare("UPDATE upload_task SET status='aborted',updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(task.id)
      .run();
    return c.json({ aborted: true });
  } catch (error) {
    console.error(error);
    return c.json({ error: "取消上传失败，请稍后重试。" }, 502);
  }
});
