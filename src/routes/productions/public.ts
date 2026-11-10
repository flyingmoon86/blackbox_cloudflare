import { EDITION_RESOURCES_SQL, EDITION_RESOURCE_COUNT_SQL } from "../../services/resource-queries";
import { serveResourceFile } from "../../services/resource-files";
import { productionVisible, resourceVisible } from "../../services/production-visibility";
import { timelinePage, type TimelineRow } from "../../views/timeline";
import { pageNumber } from "../../views/shared";
import { Hono } from "hono";
import { csrfFor } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { productionDetailPage, productionListPage } from "../../views/productions";
import type { ProductionRow, CreditRow, MemberChoice, ProductionResourceRow } from "../../services/productions/types";
import { editions } from "../../services/productions/queries";

export function registerPublicRoutes(productionRoutes: Hono<AppEnv>) {
  productionRoutes.get("/productions", async (c) => {
    const visibility =
      c.get("user")?.role === "admin" && ["public", "hidden"].includes(c.req.query("visibility") || "")
        ? c.req.query("visibility")!
        : "all";
    const visible =
      productionVisible(c, "p") + (visibility === "all" ? "" : ` AND p.is_hidden=${visibility === "hidden" ? 1 : 0}`);
    if (c.req.query("view") === "timeline") {
      const rows = await c.env.DB.prepare(
        `
      WITH years AS (
        SELECT p.id,p.title,p.is_hidden,e.year,COUNT(e.id) editions
        FROM production p LEFT JOIN production_edition e ON e.production_id=p.id
        WHERE ${visible}
        GROUP BY p.id,e.year
      )
      SELECT y.*,
        (SELECT COUNT(DISTINCT pc.member_id) FROM production_credit pc
          JOIN production_edition e ON e.id=pc.edition_id AND e.production_id=pc.production_id
          WHERE pc.production_id=y.id AND e.year IS y.year) people,
        (SELECT COUNT(*) FROM resource r JOIN production_edition e ON e.id=r.edition_id AND e.production_id=r.production_id
          WHERE r.production_id=y.id AND e.year IS y.year AND r.status='approved') resources,
        (SELECT r.id FROM production p JOIN resource r ON r.id=p.cover_id
          WHERE p.id=y.id AND r.production_id=p.id AND r.status='approved' AND r.res_type='photo') cover,
        (SELECT r.id FROM resource r JOIN production_edition e ON e.id=r.edition_id AND e.production_id=r.production_id
          WHERE r.production_id=y.id AND e.year IS y.year AND r.status='approved'
          AND r.res_type='photo' AND r.preview_filename<>'' ORDER BY r.created_at,r.id LIMIT 1) photo
      FROM years y ORDER BY y.year DESC,y.id DESC
    `,
      ).all<TimelineRow>();
      return c.html(timelinePage(rows.results, c.get("user") || null));
    }
    const search = (c.req.query("q") || "").trim().slice(0, 80);
    const pattern = "%" + search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%";
    const searchWhere = search
      ? "WHERE (p.title LIKE ? ESCAPE '\\' OR p.promo LIKE ? ESCAPE '\\' OR p.synopsis LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM production_edition e WHERE e.production_id=p.id AND (e.name LIKE ? ESCAPE '\\' OR CAST(e.year AS TEXT) LIKE ? ESCAPE '\\')))"
      : "";
    const params = search ? [pattern, pattern, pattern, pattern, pattern] : [];
    const where = `WHERE ${visible}` + (searchWhere ? " AND " + searchWhere.slice(6) : "");
    const total =
      (await c.env.DB.prepare(`SELECT COUNT(*) n FROM production p ${where}`)
        .bind(...params)
        .first<number>("n")) || 0;
    const size = 12,
      page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
    const result = await c.env.DB.prepare(
      `SELECT p.id,p.is_hidden,(p.id=(SELECT featured_production_id FROM site_profile WHERE id=1)) featured,title,synopsis,promo,COALESCE((SELECT MAX(year) FROM production_edition WHERE production_id=p.id),p.year) year,cover_id,cover_ratio,feature_layout,theme_color,(SELECT COUNT(*) FROM production_edition WHERE production_id=p.id) edition_count FROM production p ${where} ORDER BY CASE WHEN p.id=(SELECT featured_production_id FROM site_profile WHERE id=1) THEN 0 ELSE 1 END,year DESC,p.id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...params, size, (page - 1) * size)
      .all<ProductionRow>();
    return c.html(
      productionListPage(
        result.results,
        c.get("user")!,
        c.req.query("deleted") === "1",
        {
          page,
          total,
          size,
          path: "/productions",
          query: search,
          visibility: c.get("user")?.role === "admin" ? visibility : undefined,
        },
        c.get("user")?.role === "admin" ? await csrfFor(c) : "",
      ),
    );
  });

  productionRoutes.get("/productions/:id/cover", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();
    // Speculative reads may only retrieve an existing public preview, even for administrators.
    const previewOnly = c.req.query("previewOnly") === "1";
    const coverVersion = Number(c.req.query("v"));
    if (previewOnly && (!Number.isSafeInteger(coverVersion) || coverVersion <= 0)) return c.notFound();
    const photo = await c.env.DB.prepare(
      `SELECT r.id,r.filename,r.original_name,r.preview_filename FROM production p JOIN resource r ON r.id=p.cover_id WHERE p.id=? AND ${productionVisible(c, "p")} AND ${resourceVisible(c, "r")} AND r.status='approved' AND r.res_type='photo'${previewOnly ? " AND p.is_hidden=0 AND r.production_id=p.id" : ""}`,
    )
      .bind(id)
      .first<{ id: number; filename: string; original_name: string; preview_filename: string }>();
    if (!photo) return c.notFound();
    if (previewOnly && (photo.id !== coverVersion || c.req.query("size") !== "preview" || !photo.preview_filename))
      return c.notFound();
    const preview = c.req.query("size") === "preview" && photo.preview_filename;
    if (preview) {
      const response = await serveResourceFile(c.req.raw, c.env.FILES, {
        key: preview,
        filename: preview,
        publicImage: true,
      });
      if (previewOnly || response.status !== 404) return response;
    }
    return serveResourceFile(c.req.raw, c.env.FILES, {
      key: photo.filename,
      filename: photo.original_name || photo.filename,
      publicImage: true,
    });
  });

  productionRoutes.get("/productions/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const production = await c.env.DB.prepare(
      `SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout,theme_color,is_hidden FROM production WHERE id=? AND ${productionVisible(c)}`,
    )
      .bind(id)
      .first<ProductionRow>();
    if (!production) return c.text("未找到这部作品。", 404);
    if (production.is_hidden) c.header("X-Robots-Tag", "noindex, nofollow");
    const credits = await c.env.DB.prepare(
      `SELECT pc.id,pc.edition_id,pc.member_id,m.name AS member_name,pc.kind,pc.role_name FROM production_credit pc
    JOIN member m ON m.id=pc.member_id WHERE pc.production_id=? ORDER BY pc.kind,pc.id`,
    )
      .bind(id)
      .all<CreditRow>();
    const versions = await editions(c.env.DB, id);
    const selected = versions.find((v) => v.id === Number(c.req.query("edition"))) || versions[0];
    const selectedId = selected?.id || 0;
    const total = (await c.env.DB.prepare(EDITION_RESOURCE_COUNT_SQL).bind(id, selectedId).first<number>("n")) || 0;
    const size = 24,
      page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
    const resources = await c.env.DB.prepare(EDITION_RESOURCES_SQL)
      .bind(id, selectedId, size, (page - 1) * size)
      .all<ProductionResourceRow>();
    const user = c.get("user")!;
    const admin = user?.role === "admin";
    const myRequests = user?.member_id
      ? await c.env.DB.prepare(
          "SELECT status,kind,role_name,admin_note,edition_id FROM production_join_request WHERE user_id=? AND production_id=? AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 8",
        )
          .bind(user.id, id)
          .all<{ status: string; kind: string; role_name: string; admin_note: string; edition_id: number }>()
      : { results: [] };
    const members = admin
      ? await c.env.DB.prepare(
          "SELECT id,name,cohort FROM member ORDER BY join_year DESC,name COLLATE NOCASE",
        ).all<MemberChoice>()
      : { results: [] };
    return c.html(
      productionDetailPage(
        production,
        credits.results,
        resources.results,
        members.results,
        user,
        myRequests.results,
        await csrfFor(c),
        { page, total, size, path: `/productions/${id}`, edition: selectedId },
        versions,
        admin
          ? (
              await c.env.DB.prepare(
                "SELECT r.id,r.title,r.edition_id,e.name edition_name,e.year FROM resource r LEFT JOIN production_edition e ON e.id=r.edition_id WHERE r.production_id=? ORDER BY e.year DESC,r.id DESC",
              )
                .bind(id)
                .all<{ id: number; title: string; edition_id: number; edition_name: string; year: number | null }>()
            ).results
          : [],
      ),
    );
  });
}
