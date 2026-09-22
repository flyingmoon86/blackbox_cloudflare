import {
  IMPORT_SCHEMA,
  ImportError,
  identityKey,
  type ImportRow,
  type ImportBatch,
  type ImportTarget,
  type MemberMatch,
} from "./schema";

export async function target(db: D1Database, productionId: number, editionId: number): Promise<ImportTarget> {
  const found = await db
    .prepare(
      "SELECT p.id,p.title,e.id edition_id,e.name edition_name,e.year FROM production p JOIN production_edition e ON e.production_id=p.id WHERE p.id=? AND e.id=?",
    )
    .bind(productionId, editionId)
    .first<ImportTarget>();
  if (!found) throw new ImportError("作品或演出版本不存在，请重新选择。", 404);
  return found;
}
export async function getBatch(db: D1Database, id: string) {
  const batch = await db.prepare("SELECT * FROM credit_import_batch WHERE id=?").bind(id).first<ImportBatch>();
  if (!batch) throw new ImportError("未找到导入批次。", 404);
  const rows = (
    await db.prepare("SELECT * FROM credit_import_row WHERE batch_id=? ORDER BY row_number").bind(id).all<ImportRow>()
  ).results;
  return { batch, rows };
}
export async function memberChoices(db: D1Database, search = "") {
  // Keep the SSR selector bounded; a GET search is usable without JavaScript.
  const q = search.trim().slice(0, 80);
  return (
    await db
      .prepare(
        "SELECT id,name,cohort,external_id,import_revision FROM member WHERE instr(lower(name),lower(?))>0 OR instr(lower(COALESCE(external_id,'')),lower(?))>0 ORDER BY name,id LIMIT 100",
      )
      .bind(q, q)
      .all<MemberMatch>()
  ).results;
}

export type Decision = { action: "create" | "skip" | "match" | "auto"; memberId?: number };
export async function evaluate(
  db: D1Database,
  productionId: number,
  editionId: number,
  input: ImportRow[],
  decisions: Record<number, Decision> = {},
): Promise<ImportRow[]> {
  const keys = JSON.stringify(
    input.map((r) => ({
      name: identityKey(r.member_name),
      external: r.external_id,
      id: decisions[r.row_number]?.memberId ?? r.matched_member_id,
    })),
  );
  const members = (
    await db
      .prepare(
        `SELECT id,name,cohort,external_id,import_revision FROM member WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) OR lower(trim(name)) IN (SELECT json_extract(value,'$.name') FROM json_each(?)) OR external_id COLLATE NOCASE IN (SELECT json_extract(value,'$.external') FROM json_each(?))`,
      )
      .bind(keys, keys, keys)
      .all<MemberMatch>()
  ).results;
  const credits = (
    await db
      .prepare("SELECT id,member_id,kind,role_name FROM production_credit WHERE production_id=? AND edition_id=?")
      .bind(productionId, editionId)
      .all<{ id: number; member_id: number; kind: string; role_name: string }>()
  ).results;
  const rows = input.map((r) => ({ ...r, expected_credit_id: null as number | null }));
  const fail = (r: ImportRow, code: string, message: string) => {
    r.resolution = "error";
    r.error_code = code;
    r.error_message = message;
  };
  const generated = new Map<string, string>();
  for (const r of rows)
    if ((decisions[r.row_number]?.action ?? r.choice) === "create") {
      const key = identityKey(r.member_name);
      if (r.external_id || !generated.has(key))
        generated.set(key, r.external_id || r.generated_external_id || "BB-" + crypto.randomUUID());
    }
  for (const r of rows) {
    const decision = decisions[r.row_number];
    r.choice = decision?.action ?? r.choice;
    if (r.choice === "skip") {
      r.resolution = "skip";
      r.error_code = "excluded";
      r.error_message = "管理员已排除此行";
      r.matched_member_id = null;
      r.expected_member_revision = null;
      continue;
    }
    if (r.input_error) {
      fail(r, "invalid", r.input_error);
      continue;
    }
    r.error_code = "";
    r.error_message = "";
    const byName = members.filter((m) => identityKey(m.name) === identityKey(r.member_name));
    const byExternal = r.external_id
      ? members.find((m) => identityKey(m.external_id || "") === identityKey(r.external_id!))
      : undefined;
    let match: MemberMatch | undefined;
    if (r.choice === "match") match = members.find((m) => m.id === (decision?.memberId ?? r.matched_member_id));
    else match = byExternal || (byName.length === 1 ? byName[0] : undefined);
    const wantsCreate = r.choice === "create";
    if (wantsCreate) {
      if (byName.length || byExternal) {
        fail(r, "exists", "已有同名或相同外部ID档案，请关联已有档案");
        continue;
      }
      r.resolution = "create";
      r.matched_member_id = null;
      r.expected_member_revision = null;
      const nameKey = identityKey(r.member_name);
      r.generated_external_id = generated.get(nameKey)!;
      generated.set(nameKey, r.generated_external_id);
      continue;
    }
    if (!match) {
      r.matched_member_id = null;
      r.expected_member_revision = null;
      r.resolution = "unresolved";
      r.error_code = byName.length > 1 ? "ambiguous" : "missing";
      r.error_message =
        byName.length > 1 ? "有多个同名档案，请选择要关联的队员" : "未找到队员档案，请选择关联已有档案或新建";
      continue;
    }
    r.matched_member_id = match.id;
    r.expected_member_revision = match.import_revision;
    r.generated_external_id = null;
    if (
      (byExternal && byExternal.id !== match.id) ||
      (r.external_id && match.external_id && identityKey(r.external_id) !== identityKey(match.external_id))
    ) {
      fail(r, "external_conflict", "外部ID属于其他档案或与选中档案不一致");
      continue;
    }
    if (identityKey(match.name) !== identityKey(r.member_name) && r.choice !== "match") {
      fail(r, "name_conflict", "外部ID与姓名不一致，请核对后明确选择档案");
      continue;
    }
    r.resolution = "matched";
    const existing = credits.find(
      (c) => c.member_id === match.id && c.kind === r.kind && identityKey(c.role_name) === identityKey(r.role_name),
    );
    if (existing) {
      r.resolution = "skip";
      r.error_code = "duplicate";
      r.error_message = "本版本已有关联";
      r.expected_credit_id = existing.id;
    }
  }
  // One identity cannot carry contradictory names/IDs or be mapped to two members.
  const active = rows.filter((r) => !["invalid", "excluded"].includes(r.error_code)).map((r) => ({ ...r }));
  for (const r of rows.filter((r) => !["invalid", "excluded"].includes(r.error_code))) {
    const related = active.filter(
      (s) =>
        s.person_key === r.person_key ||
        (r.matched_member_id && s.matched_member_id === r.matched_member_id) ||
        (r.choice === "create" && s.choice === "create" && identityKey(r.member_name) === identityKey(s.member_name)),
    );
    const external = new Set(related.map((s) => s.external_id && identityKey(s.external_id)).filter(Boolean));
    const ids = new Set(related.map((s) => s.matched_member_id).filter(Boolean));
    const names = new Set(related.filter((s) => s.person_key === r.person_key).map((s) => identityKey(s.member_name)));
    if (external.size > 1 || ids.size > 1 || names.size > 1)
      fail(r, "identity_conflict", "同一人员的姓名、外部ID或档案选择相互冲突，请修正表格/选择");
  }
  const seen = new Set<string>();
  for (const r of rows) {
    if (!["matched", "create"].includes(r.resolution) && r.error_code !== "duplicate") continue;
    const key = JSON.stringify([r.matched_member_id || r.generated_external_id, r.kind, identityKey(r.role_name)]);
    if (seen.has(key) && !r.expected_credit_id) {
      r.resolution = "skip";
      r.error_code = "batch_duplicate";
      r.error_message = "与本批前面的关联重复";
    }
    seen.add(key);
  }
  return rows;
}
export function counts(rows: ImportRow[]) {
  return {
    add: rows.filter((r) => r.resolution === "matched" || r.resolution === "create").length,
    skip: rows.filter((r) => r.resolution === "skip").length,
    error: rows.filter((r) => r.resolution === "error" || r.resolution === "unresolved").length,
    create: new Set(rows.filter((r) => r.resolution === "create").map((r) => r.generated_external_id)).size,
  };
}
export function guard(db: D1Database, id: string, revision: number, status: string) {
  return db
    .prepare(
      "INSERT INTO credit_import_guard(batch_id,ok) VALUES(?,COALESCE((SELECT 1 FROM credit_import_batch WHERE id=? AND revision=? AND status=? AND details_purged=0),0))",
    )
    .bind(id, id, revision, status);
}
export const unguard = (db: D1Database, id: string) =>
  db.prepare("DELETE FROM credit_import_guard WHERE batch_id=?").bind(id);
export async function atomic(db: D1Database, statements: D1PreparedStatement[]) {
  try {
    await db.batch(statements);
  } catch (e) {
    if (/constraint|UNIQUE|FOREIGN KEY|CHECK|credit_import_guard/i.test(String(e)))
      throw new ImportError("数据或批次已变化，本次未写入；请重新检查预览后提交。", 409);
    throw e;
  }
}
export function rowStatements(db: D1Database, id: string, rows: ImportRow[]) {
  return [
    db.prepare("DELETE FROM credit_import_row WHERE batch_id=?").bind(id),
    db
      .prepare(
        `INSERT INTO credit_import_row(batch_id,row_number,person_key,member_name,external_id,kind,role_name,input_error,choice,matched_member_id,resolution,error_code,error_message,generated_external_id,expected_member_revision,expected_credit_id,outcome)
    SELECT ?,json_extract(value,'$.row_number'),json_extract(value,'$.person_key'),json_extract(value,'$.member_name'),json_extract(value,'$.external_id'),json_extract(value,'$.kind'),json_extract(value,'$.role_name'),json_extract(value,'$.input_error'),json_extract(value,'$.choice'),json_extract(value,'$.matched_member_id'),json_extract(value,'$.resolution'),json_extract(value,'$.error_code'),json_extract(value,'$.error_message'),json_extract(value,'$.generated_external_id'),json_extract(value,'$.expected_member_revision'),json_extract(value,'$.expected_credit_id'),COALESCE(json_extract(value,'$.outcome'),'') FROM json_each(?)`,
      )
      .bind(id, JSON.stringify(rows)),
  ];
}
export function event(
  db: D1Database,
  id: string,
  actor: { id: number; username: string },
  action: string,
  summary: string,
) {
  return db
    .prepare("INSERT INTO credit_import_event(batch_id,actor_id,actor_name,action,summary) VALUES(?,?,?,?,?)")
    .bind(id, actor.id, actor.username, action, summary);
}
export async function createPreview(
  db: D1Database,
  t: ImportTarget,
  actor: { id: number; username: string },
  filename: string,
  hash: string,
  input: ImportRow[],
) {
  const existing = await db
    .prepare(
      "SELECT id FROM credit_import_batch WHERE production_id=? AND edition_id=? AND file_sha256=? AND template_version=? AND status IN ('preview','ready','committing','committed')",
    )
    .bind(t.id, t.edition_id, hash, IMPORT_SCHEMA.version)
    .first<string>("id");
  if (existing) return existing;
  const rows = await evaluate(db, t.id, t.edition_id, input),
    n = counts(rows),
    id = crypto.randomUUID();
  try {
    await atomic(db, [
      db
        .prepare(
          `INSERT INTO credit_import_batch(id,production_id,edition_id,actor_id,actor_name,production_title,edition_label,template_version,original_name,file_sha256,status,total_rows,add_count,skip_count,error_count,create_member_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          t.id,
          t.edition_id,
          actor.id,
          actor.username,
          t.title,
          `${t.year || "年份待补"} · ${t.edition_name}`,
          IMPORT_SCHEMA.version,
          filename,
          hash,
          n.error ? "preview" : "ready",
          rows.length,
          n.add,
          n.skip,
          n.error,
          n.create,
        ),
      ...rowStatements(db, id, rows),
      event(db, id, actor, "preview", `预览 ${rows.length} 行`),
    ]);
  } catch (e) {
    const duplicate = await db
      .prepare(
        "SELECT id FROM credit_import_batch WHERE production_id=? AND edition_id=? AND file_sha256=? AND template_version=? AND status IN ('preview','ready','committing','committed')",
      )
      .bind(t.id, t.edition_id, hash, IMPORT_SCHEMA.version)
      .first<string>("id");
    if (duplicate) return duplicate;
    throw e;
  }
  return id;
}
export async function resolvePreview(
  db: D1Database,
  b: ImportBatch,
  rows: ImportRow[],
  decisions: Record<number, Decision>,
  actor: { id: number; username: string },
) {
  if (!["preview", "ready"].includes(b.status) || b.details_purged)
    throw new ImportError("此批次已结束，不能修改预览。", 409);
  await target(db, b.production_id!, b.edition_id!);
  const next = await evaluate(db, b.production_id!, b.edition_id!, rows, decisions),
    n = counts(next);
  await atomic(db, [
    guard(db, b.id, b.revision, b.status),
    ...rowStatements(db, b.id, next),
    db
      .prepare(
        "UPDATE credit_import_batch SET status=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP,add_count=?,skip_count=?,error_count=?,create_member_count=? WHERE id=?",
      )
      .bind(n.error ? "preview" : "ready", n.add, n.skip, n.error, n.create, b.id),
    event(db, b.id, actor, "resolve", `重新检查：新增 ${n.add}，跳过 ${n.skip}，待处理 ${n.error}`),
    unguard(db, b.id),
  ]);
}
