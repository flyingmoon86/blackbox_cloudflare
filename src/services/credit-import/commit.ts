import { ImportError, type ImportBatch } from "./schema";
import { atomic, event, guard, unguard } from "./store";

type Actor = { id: number; username: string };

/** All checks and writes run in one D1 transaction. No per-row network round trips. */
export async function commitImport(db: D1Database, b: ImportBatch, actor: Actor) {
  if (b.status === "committed") return;
  if (b.status !== "ready" || b.details_purged) throw new ImportError("请先处理所有待确认/错误行，再提交。", 409);
  const id = b.id;
  await atomic(db, [
    guard(db, id, b.revision, "ready"),
    db
      .prepare(
        `WITH b AS (SELECT * FROM credit_import_batch WHERE id=?), r AS (SELECT * FROM credit_import_row WHERE batch_id=?)
      UPDATE credit_import_guard SET ok=(
        EXISTS(SELECT 1 FROM b JOIN production_edition e ON e.id=b.edition_id AND e.production_id=b.production_id)
        AND EXISTS(SELECT 1 FROM r)
        AND NOT EXISTS(SELECT 1 FROM r WHERE resolution IN ('error','unresolved'))
        AND NOT EXISTS(SELECT 1 FROM r WHERE resolution<>'skip' AND input_error<>'')
        AND NOT EXISTS(SELECT 1 FROM r WHERE matched_member_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM member m WHERE m.id=r.matched_member_id AND m.import_revision=r.expected_member_revision))
        AND NOT EXISTS(SELECT 1 FROM r JOIN member m ON m.external_id=r.external_id COLLATE NOCASE
          WHERE r.resolution='matched' AND m.id<>r.matched_member_id)
        AND NOT EXISTS(SELECT 1 FROM r JOIN member m ON lower(trim(m.name))=lower(r.member_name) OR m.external_id=r.generated_external_id COLLATE NOCASE
          WHERE r.resolution='create')
        AND NOT EXISTS(SELECT 1 FROM r WHERE r.resolution='matched' AND r.choice='auto'
          AND NOT EXISTS(SELECT 1 FROM member m WHERE m.external_id=r.external_id COLLATE NOCASE)
          AND (SELECT COUNT(*) FROM member m WHERE lower(trim(m.name))=lower(r.member_name))<>1)
        AND NOT EXISTS(SELECT 1 FROM r,b WHERE r.expected_credit_id IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM production_credit c WHERE c.id=r.expected_credit_id AND c.production_id=b.production_id
            AND c.edition_id=b.edition_id AND c.member_id=r.matched_member_id AND c.kind=r.kind AND lower(trim(c.role_name))=lower(r.role_name)))
        AND NOT EXISTS(SELECT 1 FROM r,b JOIN production_credit c ON c.production_id=b.production_id AND c.edition_id=b.edition_id
          WHERE r.resolution='matched' AND c.member_id=r.matched_member_id AND c.kind=r.kind AND lower(trim(c.role_name))=lower(r.role_name))
      ) WHERE batch_id=?`,
      )
      .bind(id, id, id),
    db
      .prepare(
        `INSERT INTO member(name,external_id) SELECT member_name,generated_external_id FROM credit_import_row WHERE batch_id=? AND resolution='create' GROUP BY generated_external_id`,
      )
      .bind(id),
    db
      .prepare(
        `INSERT INTO credit_import_member_change(batch_id,member_id,change_type,after_external_id,after_revision)
      SELECT DISTINCT ?,m.id,'created',m.external_id,m.import_revision FROM member m JOIN credit_import_row r ON m.external_id=r.generated_external_id COLLATE NOCASE WHERE r.batch_id=? AND r.resolution='create'`,
      )
      .bind(id, id),
    db
      .prepare(
        `INSERT INTO credit_import_member_change(batch_id,member_id,change_type,before_external_id,after_external_id,after_revision)
      SELECT ?,m.id,'external_id_bound',m.external_id,MAX(r.external_id),m.import_revision+1 FROM member m JOIN credit_import_row r ON r.matched_member_id=m.id
      WHERE r.batch_id=? AND r.resolution='matched' AND r.external_id IS NOT NULL AND m.external_id IS NULL GROUP BY m.id`,
      )
      .bind(id, id),
    db
      .prepare(
        `UPDATE member SET external_id=(SELECT after_external_id FROM credit_import_member_change c WHERE c.batch_id=? AND c.member_id=member.id AND c.change_type='external_id_bound')
      WHERE id IN (SELECT member_id FROM credit_import_member_change WHERE batch_id=? AND change_type='external_id_bound')`,
      )
      .bind(id, id),
    db
      .prepare(
        `UPDATE credit_import_row SET matched_member_id=(SELECT id FROM member WHERE external_id=credit_import_row.generated_external_id COLLATE NOCASE)
      WHERE batch_id=? AND choice='create' AND resolution IN ('create','skip')`,
      )
      .bind(id),
    db
      .prepare(
        `INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name,import_batch_id)
      SELECT b.production_id,b.edition_id,r.matched_member_id,r.kind,r.role_name,b.id FROM credit_import_row r JOIN credit_import_batch b ON b.id=r.batch_id
      WHERE b.id=? AND r.resolution IN ('matched','create')`,
      )
      .bind(id),
    db
      .prepare(
        `UPDATE credit_import_row SET created_credit_id=(SELECT c.id FROM production_credit c WHERE c.import_batch_id=credit_import_row.batch_id AND c.member_id=credit_import_row.matched_member_id AND c.kind=credit_import_row.kind AND c.role_name=credit_import_row.role_name COLLATE NOCASE),outcome='created'
      WHERE batch_id=? AND resolution IN ('matched','create')`,
      )
      .bind(id),
    db.prepare("UPDATE credit_import_row SET outcome='skipped' WHERE batch_id=? AND resolution='skip'").bind(id),
    db
      .prepare(
        "UPDATE credit_import_batch SET status='committed',committed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?",
      )
      .bind(id),
    event(
      db,
      id,
      actor,
      "committed",
      `已新增 ${b.add_count} 条关联、新建 ${b.create_member_count} 份档案；跳过 ${b.skip_count} 行`,
    ),
    unguard(db, id),
  ]);
}

/** Later edits and references always win over rollback. Conflicts are retained for manual review. */
export async function rollbackImport(db: D1Database, b: ImportBatch, actor: Actor) {
  if (b.status === "rolled_back") return;
  if (!["committed", "rollback_conflict"].includes(b.status) || b.details_purged)
    throw new ImportError("此批次不可撤销，或已超过明细保留期。", 409);
  const id = b.id;
  const memberReferences = [
    "user",
    "join_request",
    "member_resource",
    "production_credit",
    "flower",
    "visitor_flower",
    "production_join_request",
    "site_contributor",
  ]
    .map((table) => `NOT EXISTS(SELECT 1 FROM ${table} x WHERE x.member_id=m.id)`)
    .join(" AND ");
  await atomic(db, [
    guard(db, id, b.revision, b.status),
    db
      .prepare(
        `UPDATE credit_import_row SET outcome=CASE
      WHEN NOT EXISTS(SELECT 1 FROM production_credit c WHERE c.id=created_credit_id) THEN 'absent'
      WHEN EXISTS(SELECT 1 FROM production_credit c WHERE c.id=created_credit_id AND c.import_batch_id=batch_id AND c.import_modified=0) THEN 'remove'
      ELSE 'kept' END WHERE batch_id=? AND created_credit_id IS NOT NULL AND outcome NOT IN ('removed','absent')`,
      )
      .bind(id),
    db
      .prepare(
        "DELETE FROM production_credit WHERE id IN (SELECT created_credit_id FROM credit_import_row WHERE batch_id=? AND outcome='remove') AND import_batch_id=? AND import_modified=0",
      )
      .bind(id, id),
    db.prepare("UPDATE credit_import_row SET outcome='removed' WHERE batch_id=? AND outcome='remove'").bind(id),
    db
      .prepare(
        `UPDATE credit_import_member_change SET outcome=CASE
      WHEN NOT EXISTS(SELECT 1 FROM member m WHERE m.id=member_id) THEN 'absent'
      WHEN EXISTS(SELECT 1 FROM member m WHERE m.id=member_id AND m.import_revision=after_revision AND m.external_id=after_external_id
        AND NOT EXISTS(SELECT 1 FROM credit_import_row r WHERE r.matched_member_id=m.id AND r.batch_id<>credit_import_member_change.batch_id)
        AND (change_type='external_id_bound' OR (${memberReferences}))) THEN 'remove'
      ELSE 'kept' END WHERE batch_id=? AND outcome NOT IN ('removed','absent')`,
      )
      .bind(id),
    db
      .prepare(
        "DELETE FROM member WHERE id IN (SELECT member_id FROM credit_import_member_change WHERE batch_id=? AND change_type='created' AND outcome='remove')",
      )
      .bind(id),
    db
      .prepare(
        `UPDATE member SET external_id=(SELECT before_external_id FROM credit_import_member_change c WHERE c.batch_id=? AND c.member_id=member.id AND c.change_type='external_id_bound')
      WHERE id IN (SELECT member_id FROM credit_import_member_change WHERE batch_id=? AND change_type='external_id_bound' AND outcome='remove')`,
      )
      .bind(id, id),
    db
      .prepare("UPDATE credit_import_member_change SET outcome='removed' WHERE batch_id=? AND outcome='remove'")
      .bind(id),
    db
      .prepare(
        `UPDATE credit_import_batch SET status=CASE WHEN EXISTS(SELECT 1 FROM credit_import_row WHERE batch_id=? AND outcome='kept') OR EXISTS(SELECT 1 FROM credit_import_member_change WHERE batch_id=? AND outcome='kept') THEN 'rollback_conflict' ELSE 'rolled_back' END,
      rolled_back_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?`,
      )
      .bind(id, id, id),
    db
      .prepare(
        `INSERT INTO credit_import_event(batch_id,actor_id,actor_name,action,summary) SELECT id,?,?,'rollback',CASE WHEN status='rollback_conflict' THEN '可安全撤销的记录已撤销；有后续修改/引用的记录保留' ELSE '本批新增关联及可安全还原的档案已撤销' END FROM credit_import_batch WHERE id=?`,
      )
      .bind(actor.id, actor.username, id),
    unguard(db, id),
  ]);
}

export async function purgeExpiredImports(db: D1Database) {
  // Bound scheduled work; compact batch/event audit remains, raw uploads are never retained.
  const expired =
    "SELECT id FROM credit_import_batch WHERE details_purged=0 AND created_at<datetime('now','-180 days') ORDER BY created_at LIMIT 20";
  await db.batch([
    db.prepare(`DELETE FROM credit_import_row WHERE batch_id IN (${expired})`),
    db.prepare(`DELETE FROM credit_import_member_change WHERE batch_id IN (${expired})`),
    db.prepare(
      `UPDATE credit_import_batch SET details_purged=1,original_name='',status=CASE WHEN status IN ('preview','ready','committing') THEN 'failed' ELSE status END,revision=revision+1 WHERE id IN (${expired})`,
    ),
  ]);
}
