-- Three-dimensional scene model uploads reuse the existing multipart task ledger.
ALTER TABLE upload_task ADD COLUMN three_d_scene_id TEXT REFERENCES three_d_scene(id) ON DELETE RESTRICT;
ALTER TABLE upload_task ADD COLUMN three_d_file_fingerprint TEXT;
CREATE UNIQUE INDEX ux_upload_task_three_d_active_scene ON upload_task(three_d_scene_id)
  WHERE three_d_scene_id IS NOT NULL AND status IN ('uploading','completing');
