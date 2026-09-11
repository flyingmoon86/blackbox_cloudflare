-- Temporary, pseudonymous authentication attempt counters. No existing rows are changed.
CREATE TABLE request_limit (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL CHECK (hits > 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_request_limit_expiry ON request_limit(expires_at);
