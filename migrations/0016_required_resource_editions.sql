-- Existing files keep their keys; the first edition is the legacy/default edition.
UPDATE resource SET edition_id=(SELECT id FROM production_edition WHERE production_id=resource.production_id ORDER BY id LIMIT 1) WHERE production_id IS NOT NULL AND edition_id IS NULL;
UPDATE upload_task SET edition_id=(SELECT id FROM production_edition WHERE production_id=upload_task.production_id ORDER BY id LIMIT 1) WHERE production_id IS NOT NULL AND edition_id IS NULL;
CREATE TRIGGER resource_default_edition_insert AFTER INSERT ON resource WHEN NEW.production_id IS NOT NULL AND NEW.edition_id IS NULL BEGIN
 UPDATE resource SET edition_id=(SELECT id FROM production_edition WHERE production_id=NEW.production_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER resource_default_edition_update AFTER UPDATE OF production_id,edition_id ON resource WHEN NEW.production_id IS NOT NULL AND NEW.edition_id IS NULL BEGIN
 UPDATE resource SET edition_id=(SELECT id FROM production_edition WHERE production_id=NEW.production_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER upload_default_edition_insert AFTER INSERT ON upload_task WHEN NEW.production_id IS NOT NULL AND NEW.edition_id IS NULL BEGIN
 UPDATE upload_task SET edition_id=(SELECT id FROM production_edition WHERE production_id=NEW.production_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
