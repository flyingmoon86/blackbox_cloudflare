-- Existing data is preserved. Duplicate rows must be reviewed before this migration.
CREATE UNIQUE INDEX ux_join_request_one_pending ON join_request(user_id) WHERE status='pending';
CREATE UNIQUE INDEX ux_production_credit_assignment ON production_credit(production_id,member_id,kind,role_name COLLATE NOCASE);

ALTER TABLE join_request ADD COLUMN reviewed_by INTEGER REFERENCES user(id) ON DELETE SET NULL;
ALTER TABLE join_request ADD COLUMN reviewed_at TEXT;
ALTER TABLE production_join_request ADD COLUMN reviewed_by INTEGER REFERENCES user(id) ON DELETE SET NULL;
ALTER TABLE production_join_request ADD COLUMN reviewed_at TEXT;
ALTER TABLE resource ADD COLUMN reviewed_by INTEGER REFERENCES user(id) ON DELETE SET NULL;
ALTER TABLE resource ADD COLUMN reviewed_at TEXT;
CREATE TABLE review_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 entity_type TEXT NOT NULL CHECK(entity_type IN ('member','production-join','resource')),
 entity_id INTEGER NOT NULL,
 actor_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
 decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')),
 note TEXT NOT NULL DEFAULT '',
 reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_review_history_entity ON review_history(entity_type,entity_id,id);

-- A single status UPDATE owns the transition. Triggers share its transaction:
-- stale requests update zero rows, hence no member/credit/audit side effects.
CREATE TRIGGER member_review_validate BEFORE UPDATE OF status ON join_request
WHEN NEW.reviewed_by IS NOT NULL AND NEW.status<>OLD.status AND NEW.status='approved'
BEGIN
 SELECT CASE WHEN OLD.status<>'pending' OR NOT EXISTS(
  SELECT 1 FROM user WHERE id=NEW.user_id AND role='user' AND status='active'
 ) THEN RAISE(ABORT,'review_applicant_changed') END;
 SELECT CASE WHEN NEW.apply_type='bind' AND (NOT EXISTS(SELECT 1 FROM member WHERE id=NEW.member_id)
  OR EXISTS(SELECT 1 FROM user WHERE member_id=NEW.member_id)) THEN RAISE(ABORT,'review_member_unavailable') END;
END;
CREATE TRIGGER member_review_apply AFTER UPDATE OF status ON join_request
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status='approved'
BEGIN
 INSERT INTO member(name,bio,join_year,cohort)
  SELECT NEW.name,NEW.bio,NEW.join_year,NEW.cohort WHERE NEW.apply_type='new';
 UPDATE user SET role='member',member_id=CASE WHEN NEW.apply_type='new' THEN last_insert_rowid() ELSE NEW.member_id END,
  auth_version=auth_version+1 WHERE id=NEW.user_id;
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
  VALUES('member',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
CREATE TRIGGER member_review_reject AFTER UPDATE OF status ON join_request
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status='rejected'
BEGIN
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
  VALUES('member',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
CREATE TRIGGER production_review_validate BEFORE UPDATE OF status ON production_join_request
WHEN NEW.reviewed_by IS NOT NULL AND NEW.status<>OLD.status AND NEW.status='approved'
BEGIN
 SELECT CASE WHEN OLD.status<>'pending' OR NOT EXISTS(
 SELECT 1 FROM user WHERE id=NEW.user_id AND status='active' AND role IN ('member','admin') AND member_id=NEW.member_id
 ) THEN RAISE(ABORT,'review_applicant_changed') END;
END;
CREATE TRIGGER production_review_apply AFTER UPDATE OF status ON production_join_request
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status='approved'
BEGIN
 INSERT INTO production_credit(production_id,member_id,kind,role_name)
 SELECT NEW.production_id,NEW.member_id,NEW.kind,NEW.role_name WHERE NOT EXISTS(
 SELECT 1 FROM production_credit WHERE production_id=NEW.production_id AND member_id=NEW.member_id
 AND kind=NEW.kind AND role_name=NEW.role_name COLLATE NOCASE);
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
 VALUES('production-join',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
CREATE TRIGGER production_review_reject AFTER UPDATE OF status ON production_join_request
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status='rejected'
BEGIN
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
 VALUES('production-join',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
CREATE TRIGGER resource_review_history AFTER UPDATE OF status ON resource
WHEN NEW.reviewed_by IS NOT NULL AND OLD.status='pending' AND NEW.status IN ('approved','rejected')
BEGIN
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note,reviewed_at)
 VALUES('resource',NEW.id,NEW.reviewed_by,NEW.status,NEW.admin_note,COALESCE(NEW.reviewed_at,CURRENT_TIMESTAMP));
END;
