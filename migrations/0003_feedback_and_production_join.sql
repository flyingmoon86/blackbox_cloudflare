CREATE TABLE production_join_request (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES member(id) ON DELETE CASCADE,
  production_id INTEGER NOT NULL REFERENCES production(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cast', 'crew')),
  role_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX ix_production_join_request_status ON production_join_request(status, created_at);
CREATE INDEX ix_production_join_request_user_production ON production_join_request(user_id, production_id);
CREATE UNIQUE INDEX ux_production_join_request_pending
  ON production_join_request(user_id, production_id)
  WHERE status = 'pending';

CREATE TABLE suggestion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT
);
CREATE INDEX ix_suggestion_status ON suggestion(status, created_at);
