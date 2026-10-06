import type { Bindings } from "../types";
import { cancelUpload, completeUpload } from "../services/uploads";
import { drainFileCleanup } from "../services/file-cleanup";
import { ensureStorageBudget } from "../services/upload-policy";

export async function cleanExpiredUploads(env: Bindings, deadline = Date.now() + 15_000) {
  let processed = 0;
  let failed = 0;
  // A failed inventory must be visible, but must not prevent queued file cleanup.
  let inventoryReady = false;
  try {
    await ensureStorageBudget(env);
    inventoryReady = true;
  } catch {
    failed++;
  }
  if (inventoryReady && Date.now() < deadline) {
    // Snapshot a bounded oldest-first set: failed jobs rotate to the back and cannot
    // be selected repeatedly in this run or starve later jobs on the next run.
    const tasks = await env.DB.prepare(
      "SELECT id,status FROM upload_task WHERE (status='completing' OR (status='uploading' AND expires_at<CURRENT_TIMESTAMP)) AND (lease_token IS NULL OR lease_expires_at<CURRENT_TIMESTAMP) ORDER BY updated_at,id LIMIT 100",
    ).all<{ id: string; status: string }>();
    for (const task of tasks.results) {
      if (Date.now() >= deadline) break;
      processed++;
      try {
        if (task.status === "completing") await completeUpload(env, task.id);
        else await cancelUpload(env, task.id, true);
      } catch {
        failed++;
        console.error(JSON.stringify({ event: "upload_recovery_retry" }));
        await env.DB.prepare("UPDATE upload_task SET updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(task.id).run();
      }
    }
  }
  for (let batch = 0; batch < 10 && Date.now() < deadline; batch++) {
    const result = await drainFileCleanup(env, 20, deadline);
    processed += result.processed;
    failed += result.failed;
    if (result.processed < 20) break;
  }
  // A crash between reserving space and recording an upload has no R2 parts yet.
  for (let batch = 0; batch < 10 && Date.now() < deadline; batch++) {
    const result = await env.DB.prepare(
      "DELETE FROM storage_reservation WHERE id IN (SELECT s.id FROM storage_reservation s WHERE s.expires_at<CURRENT_TIMESTAMP AND NOT EXISTS(SELECT 1 FROM upload_task t WHERE 'upload:'||t.id=s.id) AND NOT EXISTS(SELECT 1 FROM file_cleanup_task f WHERE f.reservation_id=s.id) LIMIT 20)",
    ).run();
    processed += result.meta.changes;
    if (result.meta.changes < 20) break;
  }
  return { processed, failed };
}
