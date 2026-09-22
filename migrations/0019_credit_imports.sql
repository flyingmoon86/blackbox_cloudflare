ALTER TABLE member ADD COLUMN external_id TEXT;
ALTER TABLE member ADD COLUMN import_revision INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER member_import_revision AFTER UPDATE OF name,bio,join_year,cohort,works,photo,avatar_preview,external_id ON member BEGIN
  UPDATE member SET import_revision=OLD.import_revision+1 WHERE id=NEW.id;
END;

CREATE UNIQUE INDEX ux_member_external_id
ON member(external_id COLLATE NOCASE)
WHERE external_id IS NOT NULL AND trim(external_id) <> '';

CREATE TABLE credit_import_batch (
  id TEXT PRIMARY KEY,
  production_id INTEGER REFERENCES production(id) ON DELETE SET NULL,
  edition_id INTEGER REFERENCES production_edition(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  production_title TEXT NOT NULL,
  edition_label TEXT NOT NULL,
  template_version INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview','ready','committing','committed','rolled_back','rollback_conflict','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows BETWEEN 0 AND 50),
  add_count INTEGER NOT NULL DEFAULT 0 CHECK (add_count >= 0),
  skip_count INTEGER NOT NULL DEFAULT 0 CHECK (skip_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  create_member_count INTEGER NOT NULL DEFAULT 0 CHECK (create_member_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committed_at TEXT,
  rolled_back_at TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  details_purged INTEGER NOT NULL DEFAULT 0 CHECK (details_purged IN (0,1))
);

CREATE UNIQUE INDEX ux_credit_import_active_file
ON credit_import_batch(production_id,edition_id,file_sha256,template_version)
WHERE status IN ('preview','ready','committing','committed');

CREATE INDEX ix_credit_import_actor_created
ON credit_import_batch(actor_id,created_at DESC);

CREATE TABLE credit_import_row (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES credit_import_batch(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number >= 2),
  person_key TEXT NOT NULL,
  member_name TEXT NOT NULL,
  external_id TEXT,
  kind TEXT NOT NULL,
  role_name TEXT NOT NULL,
  input_error TEXT NOT NULL DEFAULT '',
  choice TEXT NOT NULL DEFAULT 'auto' CHECK (choice IN ('auto','match','create','skip')),
  matched_member_id INTEGER REFERENCES member(id) ON DELETE SET NULL,
  resolution TEXT NOT NULL
    CHECK (resolution IN ('matched','create','skip','error','unresolved')),
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  created_credit_id INTEGER,
  expected_credit_id INTEGER,
  generated_external_id TEXT,
  expected_member_revision INTEGER,
  outcome TEXT NOT NULL DEFAULT '',
  UNIQUE(batch_id,row_number)
);

CREATE INDEX ix_credit_import_row_batch_resolution
ON credit_import_row(batch_id,resolution,row_number);

CREATE INDEX ix_credit_import_row_person
ON credit_import_row(batch_id,person_key);

CREATE TABLE credit_import_member_change (
  batch_id TEXT NOT NULL REFERENCES credit_import_batch(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('created','external_id_bound')),
  before_external_id TEXT,
  after_external_id TEXT,
  after_revision INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (batch_id,member_id,change_type)
);

ALTER TABLE production_credit ADD COLUMN import_batch_id TEXT
  REFERENCES credit_import_batch(id) ON DELETE SET NULL;
ALTER TABLE production_credit ADD COLUMN import_modified INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER credit_import_modified AFTER UPDATE OF production_id,edition_id,member_id,kind,role_name ON production_credit
WHEN OLD.import_batch_id IS NOT NULL BEGIN
  UPDATE production_credit SET import_modified=1 WHERE id=NEW.id;
END;

CREATE INDEX ix_production_credit_import_batch
ON production_credit(import_batch_id,id);

-- A CHECK failure aborts the entire D1 batch, including earlier statements.
CREATE TABLE credit_import_guard (
  batch_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok=1)
);

CREATE TABLE credit_import_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL REFERENCES credit_import_batch(id),
  actor_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_credit_import_event_batch ON credit_import_event(batch_id,id);
