import type { Bindings } from "../types";
import { abortDirectUpload } from "../storage/r2-s3";

/** Include these statements in the SAME batch that removes the resource or replaces its avatar. */
export function fileCleanupStatements(
  env: Bindings,
  keys: readonly string[],
  reservationId?: string,
): D1PreparedStatement[] {
  return [...new Set(keys.filter(Boolean))].map((key) =>
    env.DB.prepare(
      "INSERT INTO file_cleanup_task(object_key,reservation_id) VALUES(?,?) ON CONFLICT(object_key) DO UPDATE SET reservation_id=COALESCE(file_cleanup_task.reservation_id,excluded.reservation_id),next_attempt_at=CURRENT_TIMESTAMP",
    ).bind(key, reservationId ?? null),
  );
}

export function multipartCleanupStatements(
  env: Bindings,
  task: { object_key: string; multipart_upload_id: string | null; upload_mode: string },
  reservationId: string,
): D1PreparedStatement[] {
  return [
    env.DB.prepare(
      "INSERT INTO file_cleanup_task(object_key,reservation_id,multipart_upload_id,upload_mode) VALUES(?,?,?,?) ON CONFLICT(object_key) DO UPDATE SET multipart_upload_id=excluded.multipart_upload_id,upload_mode=excluded.upload_mode,reservation_id=COALESCE(file_cleanup_task.reservation_id,excluded.reservation_id),next_attempt_at=CURRENT_TIMESTAMP",
    ).bind(task.object_key, reservationId, task.multipart_upload_id, task.upload_mode),
  ];
}

export async function drainFileCleanup(env: Bindings, limit = 20): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT object_key,reservation_id,multipart_upload_id,upload_mode FROM file_cleanup_task WHERE next_attempt_at<=CURRENT_TIMESTAMP AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP) ORDER BY created_at LIMIT ?",
  )
    .bind(limit)
    .all<{
      object_key: string;
      reservation_id: string | null;
      multipart_upload_id: string | null;
      upload_mode: string | null;
    }>();
  for (const task of rows.results) {
    const token = crypto.randomUUID();
    const lock = await env.DB.prepare(
      "UPDATE file_cleanup_task SET lease_token=?,lease_expires_at=datetime('now','+5 minutes') WHERE object_key=? AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP)",
    )
      .bind(token, task.object_key)
      .run();
    if (lock.meta.changes !== 1) continue;
    try {
      const referenced = await env.DB.prepare(
        "SELECT 1 FROM resource WHERE filename=? OR preview_filename=? UNION ALL SELECT 1 FROM member WHERE photo=? UNION ALL SELECT 1 FROM upload_task WHERE (object_key=? OR preview_filename=? OR object_key||'.preview.jpg'=?) AND status IN ('uploading','completing') LIMIT 1",
      )
        .bind(task.object_key, task.object_key, task.object_key, task.object_key, task.object_key, task.object_key)
        .first();
      if (referenced) {
        await env.DB.prepare(
          "UPDATE file_cleanup_task SET next_attempt_at=datetime('now','+1 hour'),lease_token=NULL,lease_expires_at=NULL WHERE object_key=? AND lease_token=?",
        )
          .bind(task.object_key, token)
          .run();
        continue;
      }
      if (task.multipart_upload_id) {
        try {
          if (task.upload_mode === "direct") await abortDirectUpload(env, task.object_key, task.multipart_upload_id);
          else await env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).abort();
        } catch (error) {
          // Repeated cancellation, or a multipart already completed, is safe to delete by key.
          if (!/NoSuchUpload|not found|does not exist|404/i.test(String(error))) throw error;
        }
      }
      await env.FILES.delete(task.object_key);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM storage_object WHERE object_key=?").bind(task.object_key),
        env.DB.prepare("DELETE FROM file_cleanup_task WHERE object_key=? AND lease_token=?").bind(
          task.object_key,
          token,
        ),
        env.DB.prepare(
          "DELETE FROM storage_reservation WHERE id=? AND NOT EXISTS(SELECT 1 FROM file_cleanup_task WHERE reservation_id=?)",
        ).bind(task.reservation_id, task.reservation_id),
      ]);
    } catch (error) {
      console.error(JSON.stringify({ event: "file_cleanup_retry", attempted: true }));
      await env.DB.prepare(
        "UPDATE file_cleanup_task SET attempts=attempts+1,next_attempt_at=datetime('now','+5 minutes'),lease_token=NULL,lease_expires_at=NULL WHERE object_key=? AND lease_token=?",
      )
        .bind(task.object_key, token)
        .run();
    }
  }
}
