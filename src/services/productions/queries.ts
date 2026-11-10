import type { EditionRow, ResourceChoice } from "../../services/productions/types";

export async function editions(db: D1Database, id: number) {
  return (
    await db
      .prepare("SELECT * FROM production_edition WHERE production_id=? ORDER BY year DESC,id DESC")
      .bind(id)
      .all<EditionRow>()
  ).results;
}

export async function selectedEdition(db: D1Database, form: FormData, productionId: number) {
  const id = Number(form.get("edition_id"));
  return Number.isSafeInteger(id) && id > 0
    ? await db
        .prepare("SELECT id FROM production_edition WHERE id=? AND production_id=?")
        .bind(id, productionId)
        .first<number>("id")
    : null;
}

export async function resourceChoices(db: D1Database, productionId: number | null): Promise<ResourceChoice[]> {
  const result = productionId
    ? await db
        .prepare(
          "SELECT id,title,res_type,status,production_id,original_name,preview_filename FROM resource WHERE status IN ('pending','approved') AND (production_id IS NULL OR production_id=?) ORDER BY status,res_type,title",
        )
        .bind(productionId)
        .all<ResourceChoice>()
    : await db
        .prepare(
          "SELECT id,title,res_type,status,production_id,original_name,preview_filename FROM resource WHERE status IN ('pending','approved') AND production_id IS NULL ORDER BY status,res_type,title",
        )
        .all<ResourceChoice>();
  return result.results;
}

export async function selectedResourcesAllowed(db: D1Database, ids: number[], productionId: number | null) {
  if (!ids.length) return true;
  const count = await db
    .prepare(
      "SELECT COUNT(*) n FROM resource WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('pending','approved') AND (production_id IS NULL OR production_id=?)",
    )
    .bind(JSON.stringify(ids), productionId)
    .first<number>("n");
  return count === ids.length;
}
