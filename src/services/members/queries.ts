import { productionVisible } from "../../services/production-visibility";

export function memberContextQuery(filters: { search: string; year: number | "missing" | null }, page?: number) {
  const query = new URLSearchParams();
  if (filters.search) query.set("q", filters.search);
  if (filters.year !== null) query.set("year", String(filters.year));
  if (page !== undefined) query.set("page", String(page));
  return query;
}

export async function memberNameTaken(db: D1Database, name: string, excludeId?: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM member WHERE lower(trim(name)) = lower(trim(?))${excludeId ? " AND id <> ?" : ""} LIMIT 1`)
    .bind(...(excludeId ? [name, excludeId] : [name]))
    .first<{ id: number }>();
  return Boolean(row);
}

export function memberFilter(c: Parameters<typeof productionVisible>[0]) {
  const search = (c.req.query("q") ?? "").trim().slice(0, 80);
  const yearText = c.req.query("year") ?? "";
  const year: number | "missing" | null =
    yearText === "missing" ? "missing" : /^\d{1,4}$/.test(yearText) ? Number(yearText) : null;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (search) {
    where.push(
      `(m.name LIKE ? ESCAPE '\\' OR m.cohort LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM production_credit pc JOIN production p ON p.id=pc.production_id WHERE pc.member_id=m.id AND ${productionVisible(c, "p")} AND p.title LIKE ? ESCAPE '\\'))`,
    );
    const escaped = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    params.push(escaped, escaped, escaped);
  }
  if (year === "missing") {
    where.push("(m.join_year IS NULL OR m.join_year = '')");
  } else if (year !== null) {
    where.push("m.join_year = ?");
    params.push(year);
  }
  const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return { search, year, condition, params };
}
