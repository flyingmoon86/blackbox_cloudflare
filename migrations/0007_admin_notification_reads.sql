CREATE TABLE admin_notification_read (
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, notification_key)
);

CREATE INDEX ix_admin_notification_read_user ON admin_notification_read(user_id, read_at);
