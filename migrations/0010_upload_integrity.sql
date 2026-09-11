-- Additive migration: historic resources keep their IDs and a NULL task reference.
ALTER TABLE resource ADD COLUMN source_upload_task_id TEXT;
CREATE UNIQUE INDEX ux_resource_source_upload_task ON resource(source_upload_task_id)
  WHERE source_upload_task_id IS NOT NULL;
ALTER TABLE upload_task ADD COLUMN lease_token TEXT;
ALTER TABLE upload_task ADD COLUMN lease_expires_at TEXT;

CREATE TABLE storage_budget (
  id INTEGER PRIMARY KEY CHECK (id=1),
  initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0,1)),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes>=0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes>=0),
  scan_cursor TEXT,
  scan_token TEXT,
  scan_expires_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO storage_budget(id) VALUES(1);
CREATE TABLE storage_object (
  object_key TEXT PRIMARY KEY,
  size_bytes INTEGER NOT NULL CHECK (size_bytes>=0)
);
CREATE TABLE storage_reservation (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'other',
  size_bytes INTEGER NOT NULL CHECK (size_bytes>=0),
  expires_at TEXT NOT NULL DEFAULT (datetime('now','+24 hours')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_storage_reservation_user ON storage_reservation(user_id,kind);
CREATE TRIGGER storage_reservation_limit BEFORE INSERT ON storage_reservation
WHEN (SELECT initialized FROM storage_budget WHERE id=1)=1
BEGIN
  SELECT CASE WHEN (SELECT used_bytes+reserved_bytes FROM storage_budget WHERE id=1)+NEW.size_bytes>9000000000
    THEN RAISE(ABORT,'STORAGE_BUDGET_EXCEEDED') END;
  SELECT CASE WHEN NEW.kind='upload' AND
    (SELECT COUNT(*) FROM storage_reservation WHERE user_id=NEW.user_id AND kind='upload')>=3
    THEN RAISE(ABORT,'UPLOAD_CONCURRENCY_EXCEEDED') END;
END;
CREATE TRIGGER storage_reservation_added AFTER INSERT ON storage_reservation BEGIN
  UPDATE storage_budget SET reserved_bytes=reserved_bytes+NEW.size_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
CREATE TRIGGER storage_reservation_removed AFTER DELETE ON storage_reservation BEGIN
  UPDATE storage_budget SET reserved_bytes=reserved_bytes-OLD.size_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
CREATE TRIGGER storage_object_added AFTER INSERT ON storage_object BEGIN
  UPDATE storage_budget SET used_bytes=used_bytes+NEW.size_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
CREATE TRIGGER storage_object_changed AFTER UPDATE OF size_bytes ON storage_object BEGIN
  UPDATE storage_budget SET used_bytes=used_bytes+NEW.size_bytes-OLD.size_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;
CREATE TRIGGER storage_object_removed AFTER DELETE ON storage_object BEGIN
  UPDATE storage_budget SET used_bytes=used_bytes-OLD.size_bytes,updated_at=CURRENT_TIMESTAMP WHERE id=1;
END;

CREATE TABLE file_cleanup_task (
  object_key TEXT PRIMARY KEY,
  reservation_id TEXT,
  multipart_upload_id TEXT,
  upload_mode TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_file_cleanup_due ON file_cleanup_task(next_attempt_at,lease_expires_at);
