type ProductionEdit = {
  id: number;
  title: string;
  synopsis: string;
  promo: string;
  year: number | null;
  coverRatio: string;
  featureLayout: string;
  cover: number | null;
  theme: string | null;
  hidden: number | null;
  resourceIds: number[];
};

export async function saveProduction(db: D1Database, edit: ProductionEdit) {
  const ids = JSON.stringify(edit.resourceIds);
  const present = "EXISTS(SELECT 1 FROM production WHERE id=?)";
  const allowed =
    "(SELECT COUNT(*) FROM resource WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('pending','approved') AND (production_id IS NULL OR production_id=?))=?";
  const cover =
    "(? IS NULL OR EXISTS(SELECT 1 FROM resource WHERE id=? AND production_id=? AND status='approved' AND res_type='photo' AND id IN (SELECT value FROM json_each(?))))";
  const args = [edit.id, ids, edit.id, edit.resourceIds.length, edit.cover, edit.cover, edit.id, ids];
  const guard = `${present} AND ${allowed} AND ${cover}`;
  // Validation and every write share one D1 batch transaction. Conditional writes
  // also make missing/conflicting records a no-op without depending on JS checks.
  const results = await db.batch([
    db.prepare(`SELECT ${present} AS present, ${allowed} AS allowed, ${cover} AS cover`).bind(...args),
    db
      .prepare(
        `UPDATE production SET title=?,synopsis=?,promo=?,year=COALESCE(?,year),cover_ratio=?,feature_layout=?,cover_id=?,theme_color=COALESCE(?,theme_color),is_hidden=COALESCE(?,is_hidden) WHERE id=? AND ${guard}`,
      )
      .bind(
        edit.title,
        edit.synopsis,
        edit.promo,
        edit.year,
        edit.coverRatio,
        edit.featureLayout,
        edit.cover,
        edit.theme,
        edit.hidden,
        edit.id,
        ...args,
      ),
    db
      .prepare(
        `UPDATE resource SET production_id=NULL WHERE production_id=? AND id NOT IN (SELECT value FROM json_each(?)) AND ${guard}`,
      )
      .bind(edit.id, ids, ...args),
    db
      .prepare(`UPDATE resource SET production_id=? WHERE id IN (SELECT value FROM json_each(?)) AND ${guard}`)
      .bind(edit.id, ids, ...args),
  ]);
  const state = results[0].results[0] as { present: number; allowed: number; cover: number };
  return !state.present ? "missing" : !state.allowed ? "conflict" : !state.cover ? "cover" : "saved";
}
