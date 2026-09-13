CREATE TABLE production_edition (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 production_id INTEGER NOT NULL REFERENCES production(id) ON DELETE CASCADE,
 name TEXT NOT NULL DEFAULT '初始版本',
 year INTEGER,
 description TEXT NOT NULL DEFAULT '',
 UNIQUE(production_id,name,year)
);
CREATE INDEX ix_edition_production ON production_edition(production_id,year DESC,id DESC);
ALTER TABLE resource ADD COLUMN edition_id INTEGER REFERENCES production_edition(id) ON DELETE SET NULL;
ALTER TABLE upload_task ADD COLUMN edition_id INTEGER REFERENCES production_edition(id) ON DELETE SET NULL;
CREATE INDEX ix_resource_edition ON resource(edition_id,status,id);
CREATE TRIGGER resource_edition_insert_validate BEFORE INSERT ON resource WHEN NEW.edition_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
CREATE TRIGGER resource_edition_update_validate BEFORE UPDATE OF edition_id ON resource WHEN NEW.edition_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
CREATE TRIGGER resource_edition_detach AFTER UPDATE OF production_id ON resource WHEN OLD.production_id IS NOT NEW.production_id AND OLD.edition_id IS NEW.edition_id BEGIN
 UPDATE resource SET edition_id=NULL WHERE id=NEW.id;
END;
INSERT INTO production_edition(production_id,year) SELECT id,year FROM production;
ALTER TABLE production_credit ADD COLUMN edition_id INTEGER REFERENCES production_edition(id);
ALTER TABLE production_join_request ADD COLUMN edition_id INTEGER REFERENCES production_edition(id);
UPDATE production_credit SET edition_id=(SELECT id FROM production_edition WHERE production_id=production_credit.production_id);
UPDATE production_join_request SET edition_id=(SELECT id FROM production_edition WHERE production_id=production_join_request.production_id);
DROP INDEX ux_production_credit_assignment;
DROP INDEX ux_production_join_request_pending_assignment;
CREATE UNIQUE INDEX ux_production_credit_assignment ON production_credit(production_id,COALESCE(edition_id,0),member_id,kind,role_name COLLATE NOCASE);
CREATE UNIQUE INDEX ux_production_join_request_pending_assignment ON production_join_request(user_id,production_id,COALESCE(edition_id,0),kind,role_name COLLATE NOCASE) WHERE status='pending';
CREATE TRIGGER production_initial_edition AFTER INSERT ON production BEGIN
 INSERT INTO production_edition(production_id,year) VALUES(NEW.id,NEW.year);
END;
CREATE TRIGGER credit_initial_edition AFTER INSERT ON production_credit WHEN NEW.edition_id IS NULL BEGIN
 UPDATE production_credit SET edition_id=(SELECT id FROM production_edition WHERE production_id=NEW.production_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER request_initial_edition AFTER INSERT ON production_join_request WHEN NEW.edition_id IS NULL BEGIN
 UPDATE production_join_request SET edition_id=(SELECT id FROM production_edition WHERE production_id=NEW.production_id ORDER BY id LIMIT 1) WHERE id=NEW.id;
END;
CREATE TRIGGER credit_edition_update_validate BEFORE UPDATE OF edition_id,production_id ON production_credit BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
CREATE TRIGGER request_edition_update_validate BEFORE UPDATE OF edition_id,production_id ON production_join_request BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
CREATE TRIGGER edition_latest_year_insert AFTER INSERT ON production_edition BEGIN
 UPDATE production SET year=(SELECT MAX(year) FROM production_edition WHERE production_id=NEW.production_id) WHERE id=NEW.production_id;
END;
CREATE TRIGGER edition_latest_year_update AFTER UPDATE OF year ON production_edition BEGIN
 UPDATE production SET year=(SELECT MAX(year) FROM production_edition WHERE production_id=NEW.production_id) WHERE id=NEW.production_id;
END;
CREATE TRIGGER credit_edition_validate BEFORE INSERT ON production_credit WHEN NEW.edition_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
CREATE TRIGGER request_edition_validate BEFORE INSERT ON production_join_request WHEN NEW.edition_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'edition_mismatch') WHERE NOT EXISTS(SELECT 1 FROM production_edition WHERE id=NEW.edition_id AND production_id=NEW.production_id);
END;
DROP TRIGGER production_review_apply;
CREATE TRIGGER production_review_apply AFTER UPDATE OF status ON production_join_request
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status='approved'
BEGIN
 INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name)
 SELECT NEW.production_id,NEW.edition_id,NEW.member_id,NEW.kind,NEW.role_name WHERE NOT EXISTS(
 SELECT 1 FROM production_credit WHERE production_id=NEW.production_id AND edition_id IS NEW.edition_id AND member_id=NEW.member_id
 AND kind=NEW.kind AND role_name=NEW.role_name COLLATE NOCASE);
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
 VALUES('production-join',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
