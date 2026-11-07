import { Hono, type Context } from "hono";
import { csrfValid } from "../http/cookies";
import { readBoundedBody } from "../http/validation";
import { consumeAccountLimit } from "../middleware/request-limits";
import { THREE_D_MODEL_LIMIT, validateThreeDCover } from "../services/three-d-media";
import { beginThreeDModelUpload, completeThreeDModelUpload, stageThreeDCover } from "../services/three-d-uploads";
import { UploadError, uploadPolicy } from "../services/upload-policy";
import {
  assertTaskWritable,
  cancelUpload,
  expectedParts,
  streamUploadPart,
  taskExpired,
  type UploadPart,
  type UploadTask,
} from "../services/uploads";
import type { AppEnv } from "../types";

const base = "/api/admin/3d/scenes/:sceneId";
export const threeDUploadRoutes = new Hono<AppEnv>();

threeDUploadRoutes.use(base + "/*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "请先登录。" }, 401);
  if (user.role !== "admin") return c.json({ error: "没有管理员权限。" }, 403);
  if (c.req.method !== "GET" && !csrfValid(c, c.req.header("x-csrf-token") ?? null))
    return c.json({ error: "请求已失效，请刷新后重试。" }, 400);
  if (!(await c.env.DB.prepare("SELECT 1 FROM three_d_scene WHERE id=?").bind(c.req.param("sceneId")).first()))
    return c.json({ error: "场景不存在。" }, 404);
  await next();
});

async function limitWrite(c: Context<AppEnv>) {
  const retry = await consumeAccountLimit(c, "three-d-upload", 30);
  if (retry) {
    c.header("Retry-After", String(retry));
    throw new UploadError("上传次数较多，请稍后重试。", 429);
  }
}

function currentTask(c: Context<AppEnv>) {
  return c.env.DB.prepare(
    "SELECT * FROM upload_task WHERE three_d_scene_id=? AND user_id=? AND status IN ('uploading','completing')",
  )
    .bind(c.req.param("sceneId"), c.get("user")!.id)
    .first<UploadTask>();
}

async function ownedTask(c: Context<AppEnv>) {
  const task = await c.env.DB.prepare("SELECT * FROM upload_task WHERE id=? AND three_d_scene_id=? AND user_id=?")
    .bind(c.req.param("id"), c.req.param("sceneId"), c.get("user")!.id)
    .first<UploadTask>();
  if (!task) throw new UploadError("模型上传任务不存在。", 404);
  return task;
}

function statusInfo(
  task: Pick<UploadTask, "id" | "original_name" | "size_bytes" | "status" | "three_d_file_fingerprint">,
  parts: UploadPart[],
) {
  return {
    id: task.id,
    status: task.status,
    originalName: task.original_name,
    sizeBytes: task.size_bytes,
    fingerprint: task.three_d_file_fingerprint,
    partSize: uploadPolicy.partSize,
    totalParts: expectedParts(task.size_bytes),
    parts: parts.map((part) => ({ partNumber: part.part_number, sizeBytes: part.size_bytes })),
  };
}

async function statusWithParts(c: Context<AppEnv>, task: UploadTask) {
  const rows = await c.env.DB.prepare(
    "SELECT part_number,etag,size_bytes FROM upload_part WHERE task_id=? ORDER BY part_number",
  )
    .bind(task.id)
    .all<UploadPart>();
  return c.json(statusInfo(task, rows.results));
}

threeDUploadRoutes.get(base + "/uploads/current", async (c) => {
  const task = await currentTask(c);
  if (!task || (task.status === "uploading" && taskExpired(task)))
    return c.json({ error: "没有可继续的模型上传任务。" }, 404);
  return statusWithParts(c, task);
});

threeDUploadRoutes.get(base + "/uploads/:id", async (c) => statusWithParts(c, await ownedTask(c)));

threeDUploadRoutes.post(base + "/uploads", async (c) => {
  const raw = await readBoundedBody(c.req.raw, 4096);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw Error();
    body = parsed as Record<string, unknown>;
  } catch {
    throw new UploadError("上传信息格式不正确。");
  }
  const name = typeof body.originalName === "string" ? body.originalName : "";
  const size = body.sizeBytes;
  const fingerprint = body.fingerprint ?? null;
  if (!name || name.length > 255 || !/\.ply$/i.test(name) || /[/\\\x00-\x1f\x7f]/.test(name))
    throw new UploadError("请选择高斯 PLY 文件。");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1)
    throw new UploadError("模型文件大小不正确。");
  if (size > THREE_D_MODEL_LIMIT) throw new UploadError("模型不能超过 512 MiB。请压缩后重试。", 413);
  if (fingerprint !== null && (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)))
    throw new UploadError("文件指纹格式不正确。");

  await limitWrite(c);
  const previous = await currentTask(c);
  if (previous?.status === "uploading" && taskExpired(previous)) await cancelUpload(c.env, previous.id, true);
  const id = await beginThreeDModelUpload(c.env, c.req.param("sceneId")!, c.get("user")!.id, name, size, fingerprint);
  return c.json(
    statusInfo(
      {
        id,
        status: "uploading",
        original_name: name,
        size_bytes: size,
        three_d_file_fingerprint: fingerprint,
      },
      [],
    ),
    201,
  );
});

threeDUploadRoutes.put(base + "/uploads/:id/parts/:partNumber", async (c) => {
  const task = await ownedTask(c);
  assertTaskWritable(task);
  const number = Number(c.req.param("partNumber"));
  return c.json(await streamUploadPart(c.env, task, number, c.req.raw));
});

threeDUploadRoutes.post(base + "/uploads/:id/complete", async (c) => {
  const task = await ownedTask(c);
  await completeThreeDModelUpload(c.env, task.id);
  return c.json({ saved: true });
});

threeDUploadRoutes.delete(base + "/uploads/:id", async (c) => {
  const task = await ownedTask(c);
  await cancelUpload(c.env, task.id);
  return c.json({ aborted: true });
});

threeDUploadRoutes.put(base + "/cover", async (c) => {
  if (c.req.header("content-type")?.split(";")[0] !== "image/jpeg") throw new UploadError("封面必须是 JPEG 图片。");
  const bytes = await readBoundedBody(c.req.raw, uploadPolicy.previewMaxBytes);
  validateThreeDCover(bytes);
  await limitWrite(c);
  await stageThreeDCover(c.env, c.req.param("sceneId")!, c.get("user")!.id, bytes);
  return c.json({ saved: true });
});
