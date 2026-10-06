import type { Bindings } from "../types";
import { cleanExpiredUploads } from "../storage/cleanup";
import { cleanExpiredRequestLimits } from "../middleware/request-limits";
import { purgeExpiredImports } from "./credit-import/commit";

type Result = { processed: number; failed: number };
type Job = "uploads" | "request-limits" | "imports";

async function recordJob(env: Bindings, job: Job, work: (deadline: number) => Promise<Result>) {
  const started = Date.now(),
    runId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO maintenance_status(job,run_id,status) VALUES(?,?,'running') ON CONFLICT(job) DO UPDATE SET run_id=excluded.run_id,started_at=CURRENT_TIMESTAMP,finished_at=NULL,status='running',processed_count=0,failure_count=0,elapsed_ms=0",
    )
      .bind(job, runId)
      .run();
  } catch {
    // Telemetry failure must never disable the maintenance work itself.
    console.error(JSON.stringify({ event: "maintenance_status_unavailable", job }));
  }
  let result: Result = { processed: 0, failed: 0 };
  let status: "ok" | "partial" | "error" = "ok";
  try {
    result = await work(started + 15_000);
    if (result.failed) status = "partial";
  } catch {
    status = "error";
    result.failed++;
  }
  const elapsedMs = Date.now() - started;
  try {
    await env.DB.prepare(
      "UPDATE maintenance_status SET finished_at=CURRENT_TIMESTAMP,last_success_at=CASE WHEN ?='ok' THEN CURRENT_TIMESTAMP ELSE last_success_at END,status=?,processed_count=?,failure_count=?,elapsed_ms=? WHERE job=? AND run_id=?",
    )
      .bind(status, status, result.processed, result.failed, elapsedMs, job, runId)
      .run();
  } catch {
    console.error(JSON.stringify({ event: "maintenance_status_unavailable", job }));
  }
  console[status === "ok" ? "log" : "error"](
    JSON.stringify({ event: "maintenance_finished", job, status, ...result, elapsedMs }),
  );
  return { job, status, ...result };
}

export async function runMaintenance(env: Bindings) {
  return Promise.all([
    recordJob(env, "uploads", (deadline) => cleanExpiredUploads(env, deadline)),
    recordJob(env, "request-limits", async (deadline) => ({
      processed: await cleanExpiredRequestLimits(env, deadline),
      failed: 0,
    })),
    recordJob(env, "imports", async (deadline) => {
      let processed = 0;
      for (let batch = 0; batch < 10 && Date.now() < deadline; batch++) {
        const result = await purgeExpiredImports(env.DB);
        processed += result;
        if (result < 20) break;
      }
      return { processed, failed: 0 };
    }),
  ]);
}
