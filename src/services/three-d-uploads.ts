import type { Bindings } from "../types";
import { drainFileCleanup, fileCleanupStatements, multipartCleanupStatements } from "./file-cleanup";
import { reserveStorage, releaseStorageReservation, UploadError } from "./upload-policy";
import { getUploadTask, lockUploadTask, mergeUploadedParts, taskExpired, unlockUploadTask } from "./uploads";
import { validateGaussianPly } from "./three-d-media";

export async function beginThreeDModelUpload(
  env: Bindings,
  sceneId: string,
  userId: number,
  name: string,
  size: number,
  fingerprint: string | null,
): Promise<string> {
  const id = crypto.randomUUID();
  const key = "three-d-archive/" + sceneId + "/models/" + id + ".ply";
  const reservation = "upload:" + id;
  const token = crypto.randomUUID();
  await reserveStorage(env, { id: reservation, bytes: size, userId, kind: "upload" });
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO upload_task(id,user_id,object_key,original_name,content_type,size_bytes,status,expires_at,upload_mode,lease_token,lease_expires_at,res_type,three_d_scene_id,three_d_file_fingerprint)
       SELECT ?,?,?,?,'application/octet-stream',?,'uploading',datetime('now','+24 hours'),'local',?,datetime('now','+5 minutes'),'three-d',s.id,?
       FROM three_d_scene s JOIN user u ON u.id=? AND u.status='active' AND u.role='admin' WHERE s.id=?
       ON CONFLICT(three_d_scene_id) WHERE three_d_scene_id IS NOT NULL AND status IN ('uploading','completing') DO NOTHING`,
    )
      .bind(id, userId, key, name, size, token, fingerprint, userId, sceneId)
      .run();
    if (inserted.meta.changes !== 1) throw new UploadError("已有模型上传任务，请先继续或取消原任务。", 409);
  } catch (error) {
    await releaseStorageReservation(env, reservation);
    throw error;
  }

  let uploadId: string | null = null;
  try {
    uploadId = (
      await env.FILES.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/octet-stream" },
      })
    ).uploadId;
    const saved = await env.DB.prepare(
      "UPDATE upload_task SET multipart_upload_id=?,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=?",
    )
      .bind(uploadId, id, token)
      .run();
    if (saved.meta.changes !== 1) throw new UploadError("上传任务状态已变化。", 409);
  } catch {
    try {
      const task = await getUploadTask(env, id);
      // An ambiguous D1 response can arrive after the initialization already committed.
      if (uploadId && task?.multipart_upload_id === uploadId && !task.lease_token) return id;
      if (task?.lease_token === token) {
        await env.DB.batch([
          ...multipartCleanupStatements(
            env,
            {
              object_key: key,
              multipart_upload_id: uploadId,
              upload_mode: "local",
            },
            reservation,
          ),
          env.DB.prepare(
            "UPDATE upload_task SET status='aborted',lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
          ).bind(id, token),
        ]);
        await drainFileCleanup(env).catch(() => {});
      }
    } catch {
      if (uploadId) {
        // Only this request can have created this multipart; try to abort if D1 is unavailable.
        await env.FILES.resumeMultipartUpload(key, uploadId)
          .abort()
          .catch(() => {});
      }
      await unlockUploadTask(env, id, token).catch(() => {});
    }
    throw new UploadError("暂时无法开始模型上传，请稍后重试。", 502);
  }
  return id;
}

async function stageForCompletion(env: Bindings, sceneId: string, userId: number) {
  return env.DB.prepare(
    `SELECT s.pending_model_key FROM three_d_scene s
     JOIN user u ON u.id=? AND u.status='active' AND u.role='admin' WHERE s.id=?`,
  )
    .bind(userId, sceneId)
    .first<{ pending_model_key: string | null }>();
}

export async function completeThreeDModelUpload(env: Bindings, id: string): Promise<void> {
  const task = await getUploadTask(env, id);
  if (!task?.three_d_scene_id) throw new UploadError("模型上传任务不存在。", 404);
  if (task.status === "completed") return;
  if (task.status !== "uploading" && task.status !== "completing") throw new UploadError("上传任务已结束。", 410);
  if (task.status === "uploading" && taskExpired(task)) throw new UploadError("上传任务已过期，请重新上传。", 410);

  const sceneId = task.three_d_scene_id;
  const reservation = "upload:" + id;
  const token = await lockUploadTask(env, task, true);
  let leaseReleased = false;
  try {
    let stage = await stageForCompletion(env, sceneId, task.user_id);
    if (stage) {
      const object = await mergeUploadedParts(env, task, token);
      try {
        if (object.size !== task.size_bytes) throw new UploadError("模型大小与上传声明不一致，请重新上传。");
        await validateGaussianPly(env.FILES, task.object_key, object.size);
      } catch (error) {
        if (!(error instanceof UploadError) || error.status !== 400) throw error;
        await env.DB.batch([
          ...fileCleanupStatements(env, [task.object_key], reservation),
          env.DB.prepare(
            "UPDATE upload_task SET status='aborted',lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
          ).bind(id, token),
        ]);
        leaseReleased = true;
        await drainFileCleanup(env).catch(() => {});
        throw error;
      }
      // Re-read just before committing so unrelated metadata edits do not block a model.
      stage = await stageForCompletion(env, sceneId, task.user_id);
    }

    if (!stage) {
      // Recovery also checks current account privileges before making any scene changes.
      await env.DB.batch([
        ...multipartCleanupStatements(env, task, reservation),
        env.DB.prepare(
          "UPDATE upload_task SET status='aborted',lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND lease_token=?",
        ).bind(id, token),
      ]);
      leaseReleased = true;
      await drainFileCleanup(env).catch(() => {});
      throw new UploadError("账号已失去模型上传权限。", 403);
    }
    const committed = `EXISTS(SELECT 1 FROM three_d_scene s JOIN upload_task t ON t.three_d_scene_id=s.id
      WHERE t.id=? AND t.lease_token=? AND s.pending_model_key=t.object_key)`;
    const previous = stage.pending_model_key;
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE three_d_scene SET pending_model_key=?,pending_model_filename=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND pending_model_key IS ? AND EXISTS(
           SELECT 1 FROM upload_task t JOIN user u ON u.id=t.user_id
           WHERE t.id=? AND t.lease_token=? AND u.status='active' AND u.role='admin'
         )`,
      ).bind(task.object_key, task.original_name, sceneId, previous, id, token),
      env.DB.prepare(`DELETE FROM storage_reservation WHERE id=? AND ${committed}`).bind(reservation, id, token),
      env.DB.prepare(
        `INSERT INTO storage_object(object_key,size_bytes) SELECT ?,? WHERE ${committed}
         ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes`,
      ).bind(task.object_key, task.size_bytes, id, token),
      ...(previous && previous !== task.object_key
        ? [
            env.DB.prepare(
              `INSERT INTO file_cleanup_task(object_key) SELECT ? WHERE ${committed}
           AND NOT EXISTS(SELECT 1 FROM three_d_scene WHERE model_key=?)
           ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=CURRENT_TIMESTAMP`,
            ).bind(previous, id, token, previous),
          ]
        : []),
      env.DB.prepare(
        `UPDATE upload_task SET status='completed',lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND lease_token=? AND ${committed}`,
      ).bind(id, token, id, token),
    ]);
    leaseReleased = results.at(-1)?.meta.changes === 1;
    if (!leaseReleased) throw new UploadError("场景已被编辑，请刷新后继续。", 409);
    if (previous) await drainFileCleanup(env).catch(() => {});
  } finally {
    if (!leaseReleased) await unlockUploadTask(env, id, token);
  }
}

export async function stageThreeDCover(env: Bindings, sceneId: string, userId: number, bytes: Uint8Array<ArrayBuffer>) {
  const scene = await env.DB.prepare("SELECT pending_cover_key FROM three_d_scene WHERE id=?")
    .bind(sceneId)
    .first<{ pending_cover_key: string | null }>();
  if (!scene) throw new UploadError("场景不存在。", 404);
  const id = crypto.randomUUID();
  const key = "three-d-archive/" + sceneId + "/covers/" + id + ".jpg";
  const reservation = "three-d-cover:" + id;
  await reserveStorage(env, { id: reservation, bytes: bytes.byteLength, userId });
  try {
    // If the request dies after R2 accepts the image, cron still has its unique key.
    await env.DB.prepare(
      "INSERT INTO file_cleanup_task(object_key,reservation_id,next_attempt_at) VALUES(?,?,datetime('now','+10 minutes'))",
    )
      .bind(key, reservation)
      .run();
  } catch (error) {
    await releaseStorageReservation(env, reservation);
    throw error;
  }
  try {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    const previous = scene.pending_cover_key;
    const staged = "EXISTS(SELECT 1 FROM three_d_scene WHERE id=? AND pending_cover_key=?)";
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE three_d_scene SET pending_cover_key=?,pending_cover_filename='cover.jpg',revision=revision+1,updated_at=CURRENT_TIMESTAMP
         WHERE id=? AND pending_cover_key IS ? AND EXISTS(SELECT 1 FROM user WHERE id=? AND status='active' AND role='admin')`,
      ).bind(key, sceneId, previous, userId),
      env.DB.prepare("DELETE FROM storage_reservation WHERE id=? AND " + staged).bind(reservation, sceneId, key),
      env.DB.prepare(
        "INSERT INTO storage_object(object_key,size_bytes) SELECT ?,? WHERE " +
          staged +
          " ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes",
      ).bind(key, bytes.byteLength, sceneId, key),
      env.DB.prepare(`DELETE FROM file_cleanup_task WHERE object_key=? AND ${staged}`).bind(key, sceneId, key),
      ...(previous
        ? [
            env.DB.prepare(
              `INSERT INTO file_cleanup_task(object_key) SELECT ? WHERE ${staged}
           AND NOT EXISTS(SELECT 1 FROM three_d_scene WHERE cover_key=?)
           ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=CURRENT_TIMESTAMP`,
            ).bind(previous, sceneId, key, previous),
          ]
        : []),
    ]);
    if (results[0].meta.changes !== 1) throw new UploadError("场景已被编辑，请刷新后继续。", 409);
  } catch (error) {
    await env.DB.prepare("UPDATE file_cleanup_task SET next_attempt_at=CURRENT_TIMESTAMP WHERE object_key=?")
      .bind(key)
      .run();
    throw error;
  } finally {
    await drainFileCleanup(env).catch(() => {});
  }
}
