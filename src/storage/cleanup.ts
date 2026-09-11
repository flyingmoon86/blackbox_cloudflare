import type { Bindings } from "../types";
import { cancelUpload, completeUpload } from "../services/uploads";
import { drainFileCleanup } from "../services/file-cleanup";
import { ensureStorageBudget } from "../services/upload-policy";

export async function cleanExpiredUploads(env: Bindings): Promise<void> {
  try {
    await ensureStorageBudget(env);
  } catch {
    return;
  }
  const tasks = await env.DB.prepare(
    "SELECT id,status FROM upload_task WHERE (status='completing' OR (status='uploading' AND expires_at<CURRENT_TIMESTAMP)) AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP) ORDER BY updated_at LIMIT 10",
  ).all<{ id: string; status: string }>();
  for (const task of tasks.results) {
    try {
      if (task.status === "completing") await completeUpload(env, task.id);
      else await cancelUpload(env, task.id, true);
    } catch {
      console.error(JSON.stringify({ event: "upload_recovery_retry", taskId: task.id }));
      await env.DB.prepare("UPDATE upload_task SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(task.id).run();
    }
  }
  await drainFileCleanup(env);
  // A crash between reserving space and recording an upload has no R2 parts yet.
  await env.DB.prepare(
    "DELETE FROM storage_reservation WHERE id IN (SELECT s.id FROM storage_reservation s WHERE s.expires_at<CURRENT_TIMESTAMP AND NOT EXISTS(SELECT 1 FROM upload_task t WHERE 'upload:'||t.id=s.id) AND NOT EXISTS(SELECT 1 FROM file_cleanup_task f WHERE f.reservation_id=s.id) LIMIT 20)",
  ).run();
}
