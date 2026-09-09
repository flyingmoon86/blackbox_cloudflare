DROP INDEX IF EXISTS ux_production_join_request_pending;

CREATE UNIQUE INDEX ux_production_join_request_pending_assignment
  ON production_join_request(user_id, production_id, kind, role_name COLLATE NOCASE)
  WHERE status = 'pending';
