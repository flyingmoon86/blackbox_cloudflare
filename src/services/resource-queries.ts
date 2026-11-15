// Shared by the real detail route and the reproducible database experiment.
export const EDITION_RESOURCES_SQL = `SELECT id,edition_id,title,res_type,description,original_name,preview_filename FROM resource
WHERE production_id=? AND edition_id=? AND status='approved' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`;
export const EDITION_RESOURCE_COUNT_SQL =
  "SELECT COUNT(*) n FROM resource WHERE production_id=? AND edition_id=? AND status='approved'";

// Seek same-time IDs first, then the nearest timestamp. SQLite may only seek the time
// part of a (created_at,id) range when id aliases rowid, scanning tied bulk uploads.
// COALESCE short-circuits; each range returns at most one row without album counts.
export const PHOTO_NEIGHBORS_SQL = `SELECT
  COALESCE((SELECT id FROM resource
    WHERE production_id=current.production_id AND edition_id=current.edition_id
      AND status='approved' AND res_type='photo'
      AND created_at=current.created_at AND id>current.id
    ORDER BY id ASC LIMIT 1),
    (SELECT id FROM resource
    WHERE production_id=current.production_id AND edition_id=current.edition_id
      AND status='approved' AND res_type='photo' AND created_at>current.created_at
    ORDER BY created_at ASC,id ASC LIMIT 1)) previous_id,
  COALESCE((SELECT id FROM resource
    WHERE production_id=current.production_id AND edition_id=current.edition_id
      AND status='approved' AND res_type='photo'
      AND created_at=current.created_at AND id<current.id
    ORDER BY id DESC LIMIT 1),
    (SELECT id FROM resource
    WHERE production_id=current.production_id AND edition_id=current.edition_id
      AND status='approved' AND res_type='photo' AND created_at<current.created_at
    ORDER BY created_at DESC,id DESC LIMIT 1)) next_id
FROM resource current
WHERE current.id=? AND current.production_id=? AND current.edition_id=?
  AND current.status='approved' AND current.res_type='photo'`;
