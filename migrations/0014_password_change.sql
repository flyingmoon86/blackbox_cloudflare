-- Existing accounts remain unchanged; provisioned accounts must change their temporary password.
ALTER TABLE user ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1));
