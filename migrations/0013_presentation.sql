ALTER TABLE production ADD COLUMN theme_color TEXT NOT NULL DEFAULT '';
ALTER TABLE member ADD COLUMN avatar_preview TEXT NOT NULL DEFAULT '';
CREATE INDEX ix_resource_public_order ON resource(status,production_id,created_at DESC,id DESC);
