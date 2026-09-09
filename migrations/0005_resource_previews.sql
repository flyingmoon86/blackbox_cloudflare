ALTER TABLE resource ADD COLUMN preview_filename TEXT NOT NULL DEFAULT '';
ALTER TABLE upload_task ADD COLUMN preview_filename TEXT NOT NULL DEFAULT '';
