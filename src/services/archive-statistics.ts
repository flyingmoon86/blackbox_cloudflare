import type { Bindings } from "../types";
import { adminPage } from "../http/pagination";

export type ArchiveFilter = {
  year: number | "missing" | null;
  productionId: number | null;
  visibility: "all" | "public" | "hidden";
};
export type ArchiveRequest = {
  filter: ArchiveFilter;
  editionsPage: number;
  membersPage: number;
};
export type EditionStatistics = {
  edition_id: number;
  edition_name: string;
  year: number | null;
  production_id: number;
  production_title: string;
  is_hidden: number;
  credit_count: number;
  member_count: number;
  resource_count: number;
  approved_count: number;
  pending_count: number;
  rejected_count: number;
  photo_count: number;
  script_count: number;
  audio_count: number;
  video_count: number;
  other_count: number;
};
export type YearStatistics = {
  year: number | null;
  productions: number;
  editions: number;
  people: number;
  credits: number;
  approved: number;
  missing_script: number;
  missing_photo: number;
};
export type MemberStatistics = {
  member_id: number;
  member_name: string;
  productions: number;
  editions: number;
  credits: number;
  cast_count: number;
  crew_count: number;
};

/** Reject malformed values rather than silently turning a narrow filter into all data. */
export function parseArchiveRequest(params: URLSearchParams): ArchiveRequest | null {
  const keys = ["year", "production_id", "visibility", "editions_page", "members_page"];
  if (keys.some((key) => params.getAll(key).length > 1)) return null;
  const year = params.get("year") || "";
  const production = params.get("production_id") || "";
  const visibility = params.get("visibility") || "all";
  const editionsPage = params.get("editions_page") ?? "1";
  const membersPage = params.get("members_page") ?? "1";
  if (year && year !== "missing" && !/^[1-9]\d{0,3}$/.test(year)) return null;
  if (production && (!/^[1-9]\d{0,15}$/.test(production) || !Number.isSafeInteger(Number(production)))) return null;
  if (!["all", "public", "hidden"].includes(visibility)) return null;
  if (![editionsPage, membersPage].every((value) => /^[1-9]\d{0,6}$/.test(value))) return null;
  return {
    filter: {
      year: year === "missing" ? "missing" : year ? Number(year) : null,
      productionId: production ? Number(production) : null,
      visibility: visibility as ArchiveFilter["visibility"],
    },
    editionsPage: Number(editionsPage),
    membersPage: Number(membersPage),
  };
}

// Column identifiers are developer-owned; request values always use bound parameters.
function condition(
  filter: ArchiveFilter,
  columns = { year: "year", production: "production_id", hidden: "is_hidden" },
) {
  const clauses: string[] = [];
  const values: number[] = [];
  if (filter.year === "missing") clauses.push(`${columns.year} IS NULL`);
  else if (filter.year !== null) {
    clauses.push(`${columns.year}=?`);
    values.push(filter.year);
  }
  if (filter.productionId !== null) {
    clauses.push(`${columns.production}=?`);
    values.push(filter.productionId);
  }
  if (filter.visibility === "hidden") clauses.push(`${columns.hidden}=1`);
  if (filter.visibility === "public") clauses.push(`COALESCE(${columns.hidden},0)=0`);
  return { sql: clauses.length ? "WHERE " + clauses.join(" AND ") : "", values };
}

export async function readArchiveStatistics(db: Bindings["DB"], request: ArchiveRequest) {
  const { filter } = request;
  const scope = condition(filter);
  const resourceScope = condition(filter, { year: "e.year", production: "r.production_id", hidden: "p.is_hidden" });
  // An edition without a year is different from a resource without an edition/production.
  if (filter.year !== null) resourceScope.sql += (resourceScope.sql ? " AND " : "WHERE ") + "e.id IS NOT NULL";
  const [summary, people, years, reviews, publicResources, choices, yearChoices] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT production_id) AS productions,COUNT(*) AS editions,
      COALESCE(SUM(approved_count),0) AS approved,
      COALESCE(SUM(CASE WHEN script_count=0 THEN 1 ELSE 0 END),0) AS missing_script,
      COALESCE(SUM(CASE WHEN photo_count=0 THEN 1 ELSE 0 END),0) AS missing_photo
      FROM v_edition_archive_stats ${scope.sql}`,
      )
      .bind(...scope.values)
      .first<{
        productions: number;
        editions: number;
        approved: number;
        missing_script: number;
        missing_photo: number;
      }>(),
    db
      .prepare(
        `SELECT COUNT(DISTINCT member_id) AS people,COUNT(*) AS credits FROM v_member_participation ${scope.sql}`,
      )
      .bind(...scope.values)
      .first<{ people: number; credits: number }>(),
    db
      .prepare(
        `WITH editions AS (SELECT * FROM v_edition_archive_stats ${scope.sql}),
      people AS (SELECT year,COUNT(DISTINCT member_id) AS people FROM v_member_participation ${scope.sql} GROUP BY year)
      SELECT e.year,COUNT(DISTINCT e.production_id) AS productions,COUNT(*) AS editions,
      COALESCE(p.people,0) AS people,SUM(e.credit_count) AS credits,SUM(e.approved_count) AS approved,
      SUM(CASE WHEN e.script_count=0 THEN 1 ELSE 0 END) AS missing_script,
      SUM(CASE WHEN e.photo_count=0 THEN 1 ELSE 0 END) AS missing_photo
      FROM editions e LEFT JOIN people p ON p.year IS e.year
      GROUP BY e.year,p.people ORDER BY e.year DESC`,
      )
      .bind(...scope.values, ...scope.values)
      .all<YearStatistics>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN r.production_id IS NULL THEN 1 ELSE 0 END),0) AS unassigned,
      COALESCE(SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END),0) AS pending,
      COALESCE(SUM(CASE WHEN r.status='approved' THEN 1 ELSE 0 END),0) AS approved,
      COALESCE(SUM(CASE WHEN r.status='rejected' THEN 1 ELSE 0 END),0) AS rejected,
      COUNT(CASE WHEN r.reviewed_by IS NOT NULL AND r.status IN ('approved','rejected')
        AND julianday(r.reviewed_at)>=julianday(r.created_at) THEN 1 END) AS manual_samples,
      AVG(CASE WHEN r.reviewed_by IS NOT NULL AND r.status IN ('approved','rejected')
        AND julianday(r.reviewed_at)>=julianday(r.created_at)
        THEN (julianday(r.reviewed_at)-julianday(r.created_at))*24 END) AS average_review_hours
      FROM resource r LEFT JOIN production p ON p.id=r.production_id
      LEFT JOIN production_edition e ON e.id=r.edition_id AND e.production_id=r.production_id
      ${resourceScope.sql}`,
      )
      .bind(...resourceScope.values)
      .first<{
        total: number;
        unassigned: number;
        pending: number;
        approved: number;
        rejected: number;
        manual_samples: number;
        average_review_hours: number | null;
      }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM v_public_resource_info ${scope.sql}${filter.year === "missing" ? " AND edition_id IS NOT NULL" : ""}`,
      )
      .bind(...scope.values)
      .first<{ count: number }>(),
    db
      .prepare("SELECT id,title,is_hidden FROM production ORDER BY title,id")
      .all<{ id: number; title: string; is_hidden: number }>(),
    db.prepare("SELECT DISTINCT year FROM production_edition ORDER BY year DESC").all<{ year: number | null }>(),
  ]);
  const path = "/admin/archive-statistics";
  const params = {
    year: filter.year === null ? "" : String(filter.year),
    production_id: filter.productionId === null ? "" : String(filter.productionId),
    visibility: filter.visibility,
  };
  const editionsPagination = adminPage(
    summary!.editions,
    String(request.editionsPage),
    path,
    params,
    24,
    "editions_page",
  );
  const membersPagination = adminPage(people!.people, String(request.membersPage), path, params, 24, "members_page");
  // Every pager preserves the other section's actual (clamped) page.
  editionsPagination.params = { ...params, members_page: String(membersPagination.page) };
  membersPagination.params = { ...params, editions_page: String(editionsPagination.page) };
  const [editions, members] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM v_edition_archive_stats ${scope.sql}
      ORDER BY year DESC,production_id,edition_id LIMIT ? OFFSET ?`,
      )
      .bind(...scope.values, editionsPagination.size, (editionsPagination.page - 1) * editionsPagination.size)
      .all<EditionStatistics>(),
    db
      .prepare(
        `SELECT member_id,member_name,COUNT(DISTINCT production_id) AS productions,
      COUNT(DISTINCT edition_id) AS editions,COUNT(*) AS credits,
      SUM(CASE WHEN kind='cast' THEN 1 ELSE 0 END) AS cast_count,
      SUM(CASE WHEN kind='crew' THEN 1 ELSE 0 END) AS crew_count
      FROM v_member_participation ${scope.sql} GROUP BY member_id,member_name
      ORDER BY editions DESC,credits DESC,member_id LIMIT ? OFFSET ?`,
      )
      .bind(...scope.values, membersPagination.size, (membersPagination.page - 1) * membersPagination.size)
      .all<MemberStatistics>(),
  ]);
  return {
    filter,
    summary: { ...summary!, ...people!, publicResources: publicResources!.count },
    years: years.results,
    editions: editions.results,
    members: members.results,
    editionsPagination,
    membersPagination,
    reviews: reviews!,
    productions: choices.results,
    yearChoices: yearChoices.results.map((row) => row.year),
  };
}
export type ArchiveStatistics = Awaited<ReturnType<typeof readArchiveStatistics>>;
