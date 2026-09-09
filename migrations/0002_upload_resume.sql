ALTER TABLE upload_task ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE upload_task ADD COLUMN res_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE upload_task ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE upload_task ADD COLUMN upload_mode TEXT NOT NULL DEFAULT 'local' CHECK (upload_mode IN ('local', 'direct'));

CREATE TABLE upload_part (
  task_id TEXT NOT NULL REFERENCES upload_task(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK (part_number BETWEEN 1 AND 10000),
  etag TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, part_number)
);
