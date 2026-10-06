// Shared by the real detail route and the reproducible database experiment.
export const EDITION_RESOURCES_SQL = `SELECT id,edition_id,title,res_type,description,original_name,preview_filename FROM resource
WHERE production_id=? AND edition_id=? AND status='approved' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`;
export const EDITION_RESOURCE_COUNT_SQL =
  "SELECT COUNT(*) n FROM resource WHERE production_id=? AND edition_id=? AND status='approved'";
