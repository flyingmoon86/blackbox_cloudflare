-- Only approved photos participate in adjacent-photo navigation.
-- Keep time and ID together so a seek also handles bulk uploads with tied timestamps.
CREATE INDEX ix_resource_approved_photo_order
ON resource(production_id,edition_id,created_at DESC,id DESC)
WHERE status='approved' AND res_type='photo';
