-- A separate gallery; no private photo or old moment is copied/published here.
CREATE TABLE member_featured_photo (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  public_consent INTEGER NOT NULL DEFAULT 0 CHECK(public_consent IN (0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX member_featured_photo_member ON member_featured_photo(member_id,archived,status);
CREATE TABLE member_featured_photo_history (
  photo_id TEXT NOT NULL REFERENCES member_featured_photo(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  caption TEXT NOT NULL,
  status TEXT NOT NULL,
  public_consent INTEGER NOT NULL,
  archived INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(photo_id,version)
);
CREATE TRIGGER member_featured_photo_insert_audit AFTER INSERT ON member_featured_photo BEGIN
  INSERT INTO member_featured_photo_history(photo_id,version,caption,status,public_consent,archived,actor_id)
  VALUES(NEW.id,NEW.version,NEW.caption,NEW.status,NEW.public_consent,NEW.archived,NEW.updated_by);
END;
CREATE TRIGGER member_featured_photo_update_guard BEFORE UPDATE ON member_featured_photo BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.member_id<>OLD.member_id OR NEW.object_key<>OLD.object_key OR NEW.version<>OLD.version+1 THEN RAISE(ABORT,'PHOTO_VERSION_INVALID') END;
END;
CREATE TRIGGER member_featured_photo_update_audit AFTER UPDATE ON member_featured_photo BEGIN
  INSERT INTO member_featured_photo_history(photo_id,version,caption,status,public_consent,archived,actor_id)
  VALUES(NEW.id,NEW.version,NEW.caption,NEW.status,NEW.public_consent,NEW.archived,NEW.updated_by);
END;
CREATE TRIGGER member_featured_photo_history_immutable BEFORE UPDATE ON member_featured_photo_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;
CREATE TRIGGER member_featured_photo_history_no_delete BEFORE DELETE ON member_featured_photo_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;
-- Narrow graduation privacy, retaining the old consent in immutable audit history.
UPDATE member_record SET audience='admins',consent_by=NULL,version=version+1,
  updated_by=0,action='graduation_privacy_split',updated_at=CURRENT_TIMESTAMP
  WHERE kind='destination' AND (audience<>'admins' OR consent_by IS NOT NULL);
