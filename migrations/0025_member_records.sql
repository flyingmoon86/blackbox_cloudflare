-- Private records are deliberately separate from public member/resource rows.
CREATE TABLE member_record (
  id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('destination','moment')),
  graduation_year INTEGER CHECK(graduation_year BETWEEN 1900 AND 2199),
  knowledge TEXT NOT NULL DEFAULT 'unfilled' CHECK(knowledge IN ('unfilled','unknown','provided','refused')),
  destination_type TEXT CHECK(destination_type IN ('recommendation','exam','overseas','employment','entrepreneurship','other','undecided')),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  checked_at TEXT,
  title TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details)),
  audience TEXT NOT NULL DEFAULT 'admins' CHECK(audience IN ('admins','members')),
  consent_by INTEGER,
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT 'create',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(audience='admins' OR consent_by IS NOT NULL),
  CHECK(knowledge='provided' OR destination_type IS NULL)
);
CREATE UNIQUE INDEX member_record_destination_current ON member_record(member_id) WHERE kind='destination' AND archived=0;
CREATE INDEX member_record_year ON member_record(kind,archived,graduation_year);
CREATE INDEX member_record_member ON member_record(member_id,archived,kind);
CREATE TABLE member_record_history (
  record_id TEXT NOT NULL REFERENCES member_record(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(record_id,version)
);
CREATE TRIGGER member_record_insert_audit AFTER INSERT ON member_record BEGIN
  INSERT INTO member_record_history(record_id,version,snapshot,actor_id,action)
  VALUES(NEW.id,NEW.version,json_object('graduation_year',NEW.graduation_year,'knowledge',NEW.knowledge,'destination_type',NEW.destination_type,'verified',NEW.verified,'checked_at',NEW.checked_at,'title',NEW.title,'event_date',NEW.event_date,'details',json(NEW.details),'audience',NEW.audience,'consent_by',NEW.consent_by,'archived',NEW.archived),NEW.updated_by,NEW.action);
END;
CREATE TRIGGER member_record_update_guard BEFORE UPDATE ON member_record BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.member_id<>OLD.member_id OR NEW.kind<>OLD.kind OR NEW.version<>OLD.version+1 THEN RAISE(ABORT,'RECORD_VERSION_INVALID') END;
END;
CREATE TRIGGER member_record_update_audit AFTER UPDATE ON member_record BEGIN
  INSERT INTO member_record_history(record_id,version,snapshot,actor_id,action)
  VALUES(NEW.id,NEW.version,json_object('graduation_year',NEW.graduation_year,'knowledge',NEW.knowledge,'destination_type',NEW.destination_type,'verified',NEW.verified,'checked_at',NEW.checked_at,'title',NEW.title,'event_date',NEW.event_date,'details',json(NEW.details),'audience',NEW.audience,'consent_by',NEW.consent_by,'archived',NEW.archived),NEW.updated_by,NEW.action);
END;
CREATE TRIGGER member_record_history_immutable BEFORE UPDATE ON member_record_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;
CREATE TRIGGER member_record_history_no_delete BEFORE DELETE ON member_record_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;

CREATE TABLE member_record_photo (
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES member_record(id) ON DELETE RESTRICT,
  object_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX member_record_photo_record ON member_record_photo(record_id);
CREATE TABLE member_record_photo_history (
  photo_id TEXT NOT NULL REFERENCES member_record_photo(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  archived INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(photo_id,version)
);
CREATE TRIGGER member_record_photo_insert_audit AFTER INSERT ON member_record_photo BEGIN
  INSERT INTO member_record_photo_history(photo_id,version,status,archived,actor_id) VALUES(NEW.id,NEW.version,NEW.status,NEW.archived,NEW.updated_by);
END;
CREATE TRIGGER member_record_photo_update_guard BEFORE UPDATE ON member_record_photo BEGIN
  SELECT CASE WHEN NEW.id<>OLD.id OR NEW.record_id<>OLD.record_id OR NEW.object_key<>OLD.object_key OR NEW.version<>OLD.version+1 THEN RAISE(ABORT,'PHOTO_VERSION_INVALID') END;
END;
CREATE TRIGGER member_record_photo_update_audit AFTER UPDATE ON member_record_photo BEGIN
  INSERT INTO member_record_photo_history(photo_id,version,status,archived,actor_id) VALUES(NEW.id,NEW.version,NEW.status,NEW.archived,NEW.updated_by);
END;
CREATE TRIGGER member_record_photo_history_immutable BEFORE UPDATE ON member_record_photo_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;
CREATE TRIGGER member_record_photo_history_no_delete BEFORE DELETE ON member_record_photo_history BEGIN
  SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;

-- Revoking certification/binding/status also revokes consent permanently.
-- Actor 0 denotes the account lifecycle rule, not a human administrator.
CREATE TRIGGER member_record_consent_account_change AFTER UPDATE OF role,member_id,status ON user
WHEN OLD.role<>NEW.role OR OLD.member_id IS NOT NEW.member_id OR OLD.status<>NEW.status
BEGIN
  UPDATE member_record SET audience='admins',consent_by=NULL,version=version+1,
    updated_by=0,action='account_consent_revoked',updated_at=CURRENT_TIMESTAMP
    WHERE consent_by=OLD.id;
END;
CREATE TRIGGER member_record_consent_account_delete BEFORE DELETE ON user
BEGIN
  UPDATE member_record SET audience='admins',consent_by=NULL,version=version+1,
    updated_by=0,action='account_consent_revoked',updated_at=CURRENT_TIMESTAMP
    WHERE consent_by=OLD.id;
END;
