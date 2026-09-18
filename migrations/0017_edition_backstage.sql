ALTER TABLE production_edition ADD COLUMN creative_keywords TEXT;
ALTER TABLE production_edition ADD COLUMN rehearsal_place TEXT;
ALTER TABLE production_edition ADD COLUMN duration_minutes INTEGER CHECK(duration_minutes IS NULL OR (typeof(duration_minutes)='integer' AND duration_minutes>0));
ALTER TABLE production_edition ADD COLUMN backstage_story TEXT;
