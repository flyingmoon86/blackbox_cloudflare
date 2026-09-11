-- Read-only preflight. Any conflicts require administrator review; do not auto-delete.
SELECT 'duplicate_pending_members' AS check_name,COUNT(*) AS conflicts FROM (SELECT user_id FROM join_request WHERE status='pending' GROUP BY user_id HAVING COUNT(*)>1)
UNION ALL SELECT 'duplicate_credits',COUNT(*) FROM (SELECT production_id,member_id,kind,role_name COLLATE NOCASE FROM production_credit GROUP BY production_id,member_id,kind,role_name COLLATE NOCASE HAVING COUNT(*)>1);
