import { abortDirectUpload } from "./r2-s3";
import type { Bindings } from "../types";

type ExpiredTask = { id: string; object_key: string; multipart_upload_id: string; upload_mode: "local" | "direct" };

export async function cleanExpiredUploads(env: Bindings): Promise<void> {
  const tasks = await env.DB.prepare(
    "SELECT id,object_key,multipart_upload_id,upload_mode FROM upload_task WHERE status IN ('uploading','completing') AND expires_at < CURRENT_TIMESTAMP LIMIT 50",
  ).all<ExpiredTask>();
  for (const task of tasks.results) {
    try {
      if (task.upload_mode === "direct") await abortDirectUpload(env, task.object_key, task.multipart_upload_id);
      else await env.FILES.resumeMultipartUpload(task.object_key, task.multipart_upload_id).abort();
      await env.DB.prepare(
        "UPDATE upload_task SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('uploading','completing')",
      )
        .bind(task.id)
        .run();
    } catch (error) {
      console.error("清理过期上传任务失败", task.id, error);
    }
  }
}
