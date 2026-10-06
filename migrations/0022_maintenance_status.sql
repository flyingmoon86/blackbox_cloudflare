-- One bounded status row per maintenance job; no request bodies, file keys or secrets.
CREATE TABLE maintenance_status (
  job TEXT PRIMARY KEY CHECK(job IN ('uploads','request-limits','imports')),
  run_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','ok','partial','error')),
  processed_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  elapsed_ms INTEGER NOT NULL DEFAULT 0
);
