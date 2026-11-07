CREATE TABLE three_d_scene (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9999),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  production_id INTEGER REFERENCES production(id) ON DELETE SET NULL,
  edition_id INTEGER REFERENCES production_edition(id) ON DELETE SET NULL,
  model_key TEXT,
  model_filename TEXT,
  cover_key TEXT,
  cover_filename TEXT,
  pending_model_key TEXT,
  pending_model_filename TEXT,
  pending_cover_key TEXT,
  pending_cover_filename TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 0,
  CHECK(status <> 'published' OR (model_key IS NOT NULL AND cover_key IS NOT NULL))
);

CREATE INDEX ix_three_d_scene_public ON three_d_scene(status, sort_order, id);
CREATE INDEX ix_three_d_scene_production ON three_d_scene(production_id);

CREATE TRIGGER three_d_scene_edition_insert BEFORE INSERT ON three_d_scene
WHEN NEW.edition_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id
)
BEGIN
  SELECT RAISE(ABORT, 'edition_mismatch');
END;

CREATE TRIGGER three_d_scene_edition_update BEFORE UPDATE OF edition_id ON three_d_scene
WHEN NEW.edition_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id
)
BEGIN
  SELECT RAISE(ABORT, 'edition_mismatch');
END;

-- Removing a production must not expose a previously hidden linked scene.
CREATE TRIGGER three_d_scene_archive_before_production_delete BEFORE DELETE ON production
BEGIN
  UPDATE three_d_scene SET status='archived',revision=revision+1,updated_at=CURRENT_TIMESTAMP
  WHERE production_id=OLD.id AND status='published';
END;

-- Existing production objects keep their keys and public URLs.
INSERT INTO three_d_scene(id,title,sort_order,status,model_key,model_filename,cover_key,cover_filename)
VALUES
  ('03','黑匣子动物园',10,'published','three-d-archive/03/model.ply','3.ply','three-d-archive/03/cover.jpg','cover.jpg'),
  ('05','一个男人的心就这么轻轻的碎了',20,'published','three-d-archive/05/model.ply','5.ply','three-d-archive/05/cover.jpg','cover.jpg');
