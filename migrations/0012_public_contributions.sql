-- Additive changes only: preserve all existing rows and original cohort strings.
CREATE TABLE visitor_flower (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 visitor_key TEXT NOT NULL,
 member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
 sent_on TEXT NOT NULL,
 UNIQUE(visitor_key,member_id,sent_on)
);
CREATE INDEX ix_visitor_flower_member ON visitor_flower(member_id);
CREATE TABLE site_contributor (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 identity_key TEXT NOT NULL UNIQUE,
 user_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
 member_id INTEGER REFERENCES member(id) ON DELETE SET NULL,
 display_name TEXT NOT NULL,
 public_consent INTEGER NOT NULL DEFAULT 1 CHECK(public_consent IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT
);
CREATE TABLE contribution_event (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 contributor_id INTEGER NOT NULL REFERENCES site_contributor(id),
 source TEXT NOT NULL CHECK(source IN ('suggestion','admin')),
 source_key TEXT NOT NULL UNIQUE,
 actor_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE website_feedback (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_key TEXT NOT NULL UNIQUE,
 identity_key TEXT NOT NULL,
 user_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
 display_name TEXT NOT NULL,
 public_consent INTEGER NOT NULL CHECK(public_consent IN (0,1)),
 content TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 admin_note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_feedback_status ON website_feedback(status,id);
CREATE TRIGGER feedback_contribution AFTER INSERT ON website_feedback
BEGIN
 INSERT INTO site_contributor(identity_key,user_id,display_name,public_consent)
 VALUES(NEW.identity_key,NEW.user_id,NEW.display_name,NEW.public_consent)
 ON CONFLICT(identity_key) DO UPDATE SET display_name=excluded.display_name,public_consent=excluded.public_consent;
 INSERT INTO contribution_event(contributor_id,source,source_key)
 SELECT id,'suggestion','feedback:'||NEW.id FROM site_contributor WHERE identity_key=NEW.identity_key;
END;
CREATE TRIGGER resource_auto_review_insert AFTER INSERT ON resource
WHEN NEW.status='approved' AND NEW.source_upload_task_id IS NOT NULL
BEGIN
 UPDATE resource SET reviewed_at=CURRENT_TIMESTAMP WHERE id=NEW.id;
 INSERT INTO review_history(entity_type,entity_id,actor_id,decision,note)
 VALUES('resource',NEW.id,NULL,'approved','系统规则 v1：当前身份、文件格式与大小、视频禁用和容量检查通过');
END;

-- R2 ETag + size is a duplicate hint, not a cryptographic safety verdict.
ALTER TABLE resource ADD COLUMN content_fingerprint TEXT;
CREATE INDEX ix_resource_content_fingerprint ON resource(content_fingerprint);
