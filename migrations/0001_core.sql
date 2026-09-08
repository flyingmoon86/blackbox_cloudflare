PRAGMA foreign_keys = ON;

CREATE TABLE member (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  join_year INTEGER,
  cohort TEXT NOT NULL DEFAULT '',
  works TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT ''
);

CREATE TABLE user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  email TEXT COLLATE NOCASE UNIQUE,
  pending_email TEXT COLLATE NOCASE,
  auth_version INTEGER NOT NULL DEFAULT 0,
  mail_sent_at TEXT,
  join_hint_seen INTEGER NOT NULL DEFAULT 0 CHECK (join_hint_seen IN (0, 1)),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'member', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  member_id INTEGER UNIQUE REFERENCES member(id) ON DELETE SET NULL
);

CREATE TABLE email_token (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  digest TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  email TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  consumed INTEGER NOT NULL DEFAULT 0 CHECK (consumed IN (0, 1))
);
CREATE INDEX ix_email_token_user ON email_token(user_id);

CREATE TABLE join_request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  apply_type TEXT NOT NULL CHECK (apply_type IN ('bind', 'new')),
  identity_note TEXT NOT NULL DEFAULT '',
  member_id INTEGER REFERENCES member(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  join_year INTEGER,
  cohort TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  result_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (result_acknowledged IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((apply_type = 'bind' AND member_id IS NOT NULL) OR (apply_type = 'new' AND name <> ''))
);
CREATE INDEX ix_join_request_user ON join_request(user_id);
CREATE INDEX ix_join_request_status ON join_request(status);

CREATE TABLE announcement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  cover_id INTEGER,
  cover_ratio TEXT NOT NULL DEFAULT 'landscape' CHECK (cover_ratio IN ('landscape', 'portrait')),
  promo TEXT NOT NULL DEFAULT '',
  feature_layout TEXT NOT NULL DEFAULT 'split' CHECK (feature_layout IN ('split', 'overlay')),
  year INTEGER
);

CREATE TABLE resource (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER REFERENCES production(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected')),
  uploader_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
  admin_note TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  res_type TEXT NOT NULL DEFAULT 'other' CHECK (res_type IN ('video', 'script', 'photo', 'audio', 'other')),
  description TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL DEFAULT '',
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_resource_production ON resource(production_id);
CREATE INDEX ix_resource_status ON resource(status);
CREATE INDEX ix_resource_uploader ON resource(uploader_id);

CREATE TABLE member_resource (
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  resource_id INTEGER NOT NULL REFERENCES resource(id) ON DELETE CASCADE,
  PRIMARY KEY (member_id, resource_id)
);

CREATE TABLE production_credit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES production(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cast', 'crew')),
  role_name TEXT NOT NULL
);
CREATE INDEX ix_production_credit_production ON production_credit(production_id);
CREATE INDEX ix_production_credit_member ON production_credit(member_id);

CREATE TABLE flower (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  sent_on TEXT NOT NULL,
  UNIQUE (user_id, member_id, sent_on)
);
CREATE INDEX ix_flower_member ON flower(member_id);

CREATE TABLE site_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  troupe_name TEXT NOT NULL DEFAULT '话剧队',
  introduction TEXT,
  contact_email TEXT,
  contact_wechat TEXT,
  recruitment_open INTEGER NOT NULL DEFAULT 1 CHECK (recruitment_open IN (0, 1)),
  founded_year INTEGER,
  qq_group TEXT NOT NULL DEFAULT '',
  public_account TEXT NOT NULL DEFAULT '',
  recruitment TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  hero_photo TEXT NOT NULL DEFAULT '',
  featured_production_id INTEGER REFERENCES production(id) ON DELETE SET NULL,
  page_texts TEXT NOT NULL DEFAULT '{}',
  CHECK (json_valid(page_texts))
);

CREATE TABLE upload_task (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  production_id INTEGER REFERENCES production(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  multipart_upload_id TEXT,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'completing', 'completed', 'aborted', 'expired')),
  resource_id INTEGER REFERENCES resource(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_upload_task_user ON upload_task(user_id);
CREATE INDEX ix_upload_task_status_expiry ON upload_task(status, expires_at);

INSERT INTO site_profile (id, contact_email) VALUES (1, 'moonflying56@gmail.com');
