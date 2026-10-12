-- Read-only query interfaces. Admin views do not replace application authorization.
CREATE VIEW v_public_resource_info AS
SELECT r.id AS resource_id,r.title,r.res_type,r.created_at,
       p.id AS production_id,p.title AS production_title,
       e.id AS edition_id,e.name AS edition_name,e.year,
       0 AS is_hidden
FROM resource r
LEFT JOIN production p ON p.id=r.production_id
LEFT JOIN production_edition e ON e.id=r.edition_id AND e.production_id=r.production_id
WHERE r.status='approved'
  AND (r.production_id IS NULL OR p.is_hidden=0)
  AND (r.edition_id IS NULL OR e.id IS NOT NULL);

-- Aggregate each N-side first: joining raw credits with raw resources inflates counts.
CREATE VIEW v_edition_archive_stats AS
WITH credits AS (
  SELECT edition_id,production_id,COUNT(*) AS credit_count,COUNT(DISTINCT member_id) AS member_count
  FROM production_credit GROUP BY edition_id,production_id
), files AS (
  SELECT edition_id,production_id,
    COUNT(*) AS resource_count,
    SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count,
    SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected_count,
    SUM(CASE WHEN status='approved' AND res_type='photo' THEN 1 ELSE 0 END) AS photo_count,
    SUM(CASE WHEN status='approved' AND res_type='script' THEN 1 ELSE 0 END) AS script_count,
    SUM(CASE WHEN status='approved' AND res_type='audio' THEN 1 ELSE 0 END) AS audio_count,
    SUM(CASE WHEN status='approved' AND res_type='video' THEN 1 ELSE 0 END) AS video_count,
    SUM(CASE WHEN status='approved' AND res_type='other' THEN 1 ELSE 0 END) AS other_count
  FROM resource GROUP BY edition_id,production_id
)
SELECT e.id AS edition_id,e.name AS edition_name,e.year,p.id AS production_id,
  p.title AS production_title,p.is_hidden,
  COALESCE(c.credit_count,0) AS credit_count,COALESCE(c.member_count,0) AS member_count,
  COALESCE(f.resource_count,0) AS resource_count,
  COALESCE(f.approved_count,0) AS approved_count,COALESCE(f.pending_count,0) AS pending_count,
  COALESCE(f.rejected_count,0) AS rejected_count,
  COALESCE(f.photo_count,0) AS photo_count,COALESCE(f.script_count,0) AS script_count,
  COALESCE(f.audio_count,0) AS audio_count,COALESCE(f.video_count,0) AS video_count,
  COALESCE(f.other_count,0) AS other_count
FROM production_edition e JOIN production p ON p.id=e.production_id
LEFT JOIN credits c ON c.edition_id=e.id AND c.production_id=p.id
LEFT JOIN files f ON f.edition_id=e.id AND f.production_id=p.id;

CREATE VIEW v_member_participation AS
SELECT pc.id AS credit_id,m.id AS member_id,m.name AS member_name,
  p.id AS production_id,p.title AS production_title,p.is_hidden,
  e.id AS edition_id,e.name AS edition_name,e.year,pc.kind,pc.role_name
FROM production_credit pc JOIN member m ON m.id=pc.member_id
JOIN production_edition e ON e.id=pc.edition_id AND e.production_id=pc.production_id
JOIN production p ON p.id=e.production_id;
