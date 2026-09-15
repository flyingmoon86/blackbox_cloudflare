import { serveResourceFile } from "../services/resource-files";
import { consumeAccountLimit } from "../middleware/request-limits";
import { validAccent } from "../services/theme";
import { pageNumber } from "../views/shared";
import { reviewRequest } from "../services/reviews";
import { Hono, type Context } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import {
  productionDetailPage,
  productionFormPage,
  productionListPage,
  productionRequestsPage,
} from "../views/productions";

export type ProductionRow = {
  featured?: number;
  edition_count?: number;
  theme_color?: string;
  id: number;
  title: string;
  synopsis: string;
  promo: string;
  year: number | null;
  cover_id: number | null;
  cover_ratio: string;
  feature_layout: string;
};
export type CreditRow = {
  edition_id?: number | null;
  id: number;
  member_id: number;
  member_name: string;
  kind: "cast" | "crew";
  role_name: string;
};
export type MemberChoice = { id: number; name: string; cohort: string };
export type EditionRow = { id: number; production_id: number; name: string; year: number | null; description: string };
export type ProductionResourceRow = {
  edition_id?: number | null;
  id: number;
  title: string;
  res_type: string;
  description: string;
  original_name: string;
  preview_filename: string;
};
export type ResourceChoice = {
  id: number;
  title: string;
  res_type: string;
  status: "pending" | "approved";
  production_id: number | null;
};
export type ProductionJoinRequestRow = {
  edition_name?: string;
  id: number;
  user_id: number;
  username: string;
  member_id: number;
  member_name: string;
  production_id: number;
  production_title: string;
  kind: "cast" | "crew";
  role_name: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string;
  created_at: string;
  existing_names: string;
};

export const productionRoutes = new Hono<AppEnv>();

async function editions(c: Context<AppEnv>, id: number) {
  return (
    await c.env.DB.prepare("SELECT * FROM production_edition WHERE production_id=? ORDER BY year DESC,id DESC")
      .bind(id)
      .all<EditionRow>()
  ).results;
}
async function selectedEdition(c: Context<AppEnv>, form: FormData, productionId: number) {
  const id = Number(form.get("edition_id"));
  return Number.isSafeInteger(id) && id > 0
    ? await c.env.DB.prepare("SELECT id FROM production_edition WHERE id=? AND production_id=?")
        .bind(id, productionId)
        .first<number>("id")
    : null;
}

productionRoutes.post("/admin/productions/:id/editions", async (c) => {
  if (c.get("user")?.role !== "admin") return c.text("没有管理员权限。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
  const productionId = Number(c.req.param("id")),
    name = String(form.get("name") || "").trim(),
    year = Number(form.get("year"));
  if (!name || name.length > 80 || !Number.isInteger(year) || year < 1 || year > 9999)
    return c.text("请填写版本名称和年份。", 400);
  if (!(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(productionId).first())) return c.notFound();
  try {
    await c.env.DB.prepare("INSERT INTO production_edition(production_id,name,year,description) VALUES(?,?,?,?)")
      .bind(
        productionId,
        name,
        year,
        String(form.get("description") || "")
          .trim()
          .slice(0, 10000),
      )
      .run();
  } catch (error) {
    if (/UNIQUE/.test(String(error))) return c.text("同年已有同名版本。", 409);
    throw error;
  }
  return c.redirect("/productions/" + productionId, 303);
});

productionRoutes.post("/admin/productions/:id/move-resources", async (c) => {
  if (c.get("user")?.role !== "admin") return c.text("没有管理员权限。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
  const production = Number(c.req.param("id")),
    edition = await selectedEdition(c, form, production);
  const ids = selectedResourceIds(form);
  if (!edition || !ids?.length || ids.length > 100) return c.text("请选择目标版本和最多 100 份资料。", 400);
  const encoded = JSON.stringify(ids);
  const result = await c.env.DB.prepare(
    "UPDATE resource SET edition_id=? WHERE production_id=? AND id IN (SELECT value FROM json_each(?)) AND (SELECT COUNT(*) FROM resource WHERE production_id=? AND id IN (SELECT value FROM json_each(?)))=?",
  )
    .bind(edition, production, encoded, production, encoded, ids.length)
    .run();
  if (result.meta.changes !== ids.length) return c.text("资料归属已变化，本次未移动，请刷新后重试。", 409);
  return c.redirect(`/productions/${production}#edition-${edition}`, 303);
});

productionRoutes.post("/admin/productions/:id/editions/:editionId", async (c) => {
  if (c.get("user")?.role !== "admin") return c.text("没有管理员权限。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
  const productionId = Number(c.req.param("id")),
    editionId = Number(c.req.param("editionId"));
  const name = String(form.get("name") || "").trim(),
    yearText = String(form.get("year") || "").trim();
  const previous = await c.env.DB.prepare("SELECT year FROM production_edition WHERE id=? AND production_id=?")
    .bind(editionId, productionId)
    .first<{ year: number | null }>();
  if (!previous) return c.notFound();
  const year = yearText ? Number(yearText) : previous.year;
  if (!name || name.length > 80 || (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)))
    return c.text("请检查版本名称和年份。", 400);
  try {
    const result = await c.env.DB.prepare(
      "UPDATE production_edition SET name=?,year=?,description=? WHERE id=? AND production_id=?",
    )
      .bind(
        name,
        year,
        String(form.get("description") || "")
          .trim()
          .slice(0, 10000),
        editionId,
        productionId,
      )
      .run();
    if (!result.meta.changes) return c.notFound();
  } catch (error) {
    if (/UNIQUE/.test(String(error))) return c.text("同年已有同名版本。", 409);
    throw error;
  }
  return c.redirect(`/productions/${productionId}#edition-${editionId}`, 303);
});

productionRoutes.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/productions") && !c.req.path.startsWith("/admin/production")) return next();
  if (!c.get("user") && !(c.req.method === "GET" && /^\/productions(?:\/\d+(?:\/cover)?)?$/.test(c.req.path)))
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

function adminOnly(c: any): Response | null {
  return c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403);
}

function selectedResourceIds(form: FormData): number[] | null {
  const ids = [...new Set(form.getAll("resource_ids").map(Number))];
  return ids.every((id) => Number.isInteger(id) && id > 0) ? ids : null;
}

async function resourceChoices(c: Context<AppEnv>, productionId: number | null): Promise<ResourceChoice[]> {
  const result = productionId
    ? await c.env.DB.prepare(
        "SELECT id,title,res_type,status,production_id FROM resource WHERE status IN ('pending','approved') AND (production_id IS NULL OR production_id=?) ORDER BY status,res_type,title",
      )
        .bind(productionId)
        .all<ResourceChoice>()
    : await c.env.DB.prepare(
        "SELECT id,title,res_type,status,production_id FROM resource WHERE status IN ('pending','approved') AND production_id IS NULL ORDER BY status,res_type,title",
      ).all<ResourceChoice>();
  return result.results;
}

productionRoutes.get("/productions", async (c) => {
  const search = (c.req.query("q") || "").trim().slice(0, 80);
  const pattern = "%" + search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%";
  const where = search
    ? "WHERE (p.title LIKE ? ESCAPE '\\' OR p.promo LIKE ? ESCAPE '\\' OR p.synopsis LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM production_edition e WHERE e.production_id=p.id AND (e.name LIKE ? ESCAPE '\\' OR CAST(e.year AS TEXT) LIKE ? ESCAPE '\\')))"
    : "";
  const params = search ? [pattern, pattern, pattern, pattern, pattern] : [];
  const total =
    (await c.env.DB.prepare(`SELECT COUNT(*) n FROM production p ${where}`)
      .bind(...params)
      .first<number>("n")) || 0;
  const size = 12,
    page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
  const result = await c.env.DB.prepare(
    `SELECT p.id,(p.id=(SELECT featured_production_id FROM site_profile WHERE id=1)) featured,title,synopsis,promo,COALESCE((SELECT MAX(year) FROM production_edition WHERE production_id=p.id),p.year) year,cover_id,cover_ratio,feature_layout,theme_color,(SELECT COUNT(*) FROM production_edition WHERE production_id=p.id) edition_count FROM production p ${where} ORDER BY CASE WHEN p.id=(SELECT featured_production_id FROM site_profile WHERE id=1) THEN 0 ELSE 1 END,year DESC,p.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, size, (page - 1) * size)
    .all<ProductionRow>();
  return c.html(
    productionListPage(result.results, c.get("user")!, c.req.query("deleted") === "1", {
      page,
      total,
      size,
      path: "/productions",
      query: search,
    }),
  );
});

productionRoutes.get("/productions/:id/cover", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();
  const photo = await c.env.DB.prepare(
    "SELECT r.filename,r.original_name FROM production p JOIN resource r ON r.id=p.cover_id WHERE p.id=? AND r.status='approved' AND r.res_type='photo'",
  )
    .bind(id)
    .first<{ filename: string; original_name: string }>();
  if (!photo) return c.notFound();
  return serveResourceFile(c.req.raw, c.env.FILES, {
    key: photo.filename,
    filename: photo.original_name || photo.filename,
    publicImage: true,
  });
});

productionRoutes.get("/productions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const production = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout,theme_color FROM production WHERE id=?",
  )
    .bind(id)
    .first<ProductionRow>();
  if (!production) return c.text("未找到这部作品。", 404);
  const credits = await c.env.DB.prepare(
    `SELECT pc.id,pc.edition_id,pc.member_id,m.name AS member_name,pc.kind,pc.role_name FROM production_credit pc
    JOIN member m ON m.id=pc.member_id WHERE pc.production_id=? ORDER BY pc.kind,pc.id`,
  )
    .bind(id)
    .all<CreditRow>();
  const versions = await editions(c, id);
  const selected = versions.find((v) => v.id === Number(c.req.query("edition"))) || versions[0];
  const selectedId = selected?.id || 0;
  const total =
    (await c.env.DB.prepare(
      "SELECT COUNT(*) n FROM resource WHERE production_id=? AND edition_id=? AND status='approved'",
    )
      .bind(id, selectedId)
      .first<number>("n")) || 0;
  const size = 24,
    page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
  const resources = await c.env.DB.prepare(
    `SELECT id,edition_id,title,res_type,description,original_name,preview_filename FROM resource
    WHERE production_id=? AND edition_id=? AND status='approved' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
  )
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

productionRoutes.post("/productions/:id/join", async (c) => {
  const user = c.get("user")!;
  if (user.role === "user" || !user.member_id) return c.text("只有认证队员可以申请加入作品。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
  const productionId = Number(c.req.param("id"));
  const editionId = await selectedEdition(c, form, productionId);
  if (!editionId) return c.text("请选择本作品的演出版本。", 400);
  const kind = form.get("kind") === "crew" ? "crew" : "cast";
  const roleName = String(form.get("role_name") ?? "").trim();
  if (!roleName || roleName.length > 80) return c.text("请填写 1–80 字的角色或分工。", 400);
  if (!(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(productionId).first()))
    return c.text("作品不存在。", 404);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM production_credit WHERE production_id=? AND edition_id=? AND member_id=? AND kind=? AND role_name=? COLLATE NOCASE LIMIT 1",
    )
      .bind(productionId, editionId, user.member_id, kind, roleName)
      .first()
  )
    return c.text("这条角色或分工已经在演职员名单中，可以继续申请其他角色。", 409);
  const retry = await consumeAccountLimit(c, "production-join-request", 30);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("申请次数较多，请稍后重试。", 429);
  }
  try {
    await c.env.DB.prepare(
      "INSERT INTO production_join_request(user_id,member_id,production_id,edition_id,kind,role_name) VALUES(?,?,?,?,?,?)",
    )
      .bind(user.id, user.member_id, productionId, editionId, kind, roleName)
      .run();
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(String(error))) throw error;
    return c.text("这条角色或分工已经提交并正在等待审核，可以继续申请不同的角色。", 409);
  }
  return c.redirect(`/productions/${productionId}?join=pending`, 303);
});

productionRoutes.get("/admin/productions/new", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  return c.html(productionFormPage(null, await csrfFor(c), [], await resourceChoices(c, null)));
});

productionRoutes.post("/admin/productions/new", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const theme = String(form.get("theme_color") || "").trim();
  if (theme && !validAccent(theme)) return c.text("作品颜色请填写 #RRGGBB 格式。", 400);
  const title = String(form.get("title") ?? "").trim();
  const versionNames = form.getAll("edition_name").map((v) => String(v).trim());
  const versionYears = form.getAll("edition_year").map((v) => String(v).trim());
  if (
    versionNames.length > 30 ||
    versionYears.length !== versionNames.length ||
    versionNames.some((n, i) => !n || n.length > 80 || !/^\d{4}$/.test(versionYears[i]))
  )
    return c.text("请为每个版本填写名称与四位年份。", 400);
  if (new Set(versionNames.map((n, i) => versionYears[i] + ":" + n)).size !== versionNames.length)
    return c.text("同一年不能重复添加同名版本。", 400);
  const yearText = String(form.get("year") ?? "").trim();
  const year = yearText ? Number(yearText) : null;
  const resourceIds = selectedResourceIds(form);
  if (
    !title ||
    !resourceIds ||
    title.length > 100 ||
    (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
  )
    return c.text("请检查作品名称和年份。", 400);
  const allowed = await resourceChoices(c, null);
  const allowedIds = new Set(allowed.map((resource) => resource.id));
  if (!resourceIds.every((id) => allowedIds.has(id))) return c.text("选择的资料已被其他作品使用。", 409);
  const insert = c.env.DB.prepare(
    "INSERT INTO production(title,synopsis,promo,year,cover_ratio,feature_layout,theme_color) VALUES(?,?,?,?,?,?,?)",
  ).bind(
    title,
    String(form.get("synopsis") ?? "").trim(),
    String(form.get("promo") ?? "")
      .trim()
      .slice(0, 300),
    year,
    form.get("cover_ratio") === "portrait" ? "portrait" : "landscape",
    form.get("feature_layout") === "overlay" ? "overlay" : "split",
    theme,
  );
  const statements = [insert];
  if (versionNames.length)
    statements.push(
      c.env.DB.prepare("UPDATE production_edition SET name=?,year=? WHERE production_id=last_insert_rowid()").bind(
        versionNames[0],
        Number(versionYears[0]),
      ),
    );
  if (resourceIds.length)
    statements.push(
      c.env.DB.prepare(
        "UPDATE resource SET production_id=last_insert_rowid() WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('pending','approved') AND production_id IS NULL",
      ).bind(JSON.stringify(resourceIds)),
    );
  if (versionNames.length > 1)
    statements.push(
      c.env.DB.prepare(
        `WITH target AS MATERIALIZED (SELECT last_insert_rowid() id)
    INSERT INTO production_edition(production_id,name,year) SELECT target.id,json_extract(j.value,'$.name'),json_extract(j.value,'$.year') FROM target,json_each(?) j`,
      ).bind(JSON.stringify(versionNames.slice(1).map((name, i) => ({ name, year: Number(versionYears[i + 1]) })))),
    );
  const results = await c.env.DB.batch(statements);
  const productionId = Number(results[0].meta.last_row_id);
  return c.redirect(`/productions/${productionId}`, 303);
});

productionRoutes.get("/admin/productions/:id/edit", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const id = Number(c.req.param("id"));
  const production = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout,theme_color FROM production WHERE id=?",
  )
    .bind(id)
    .first<ProductionRow>();
  if (!production) return c.text("未找到这部作品。", 404);
  const covers = await c.env.DB.prepare(
    "SELECT id,title FROM resource WHERE production_id=? AND status='approved' AND res_type='photo' ORDER BY id DESC",
  )
    .bind(id)
    .all<{ id: number; title: string }>();
  return c.html(productionFormPage(production, await csrfFor(c), covers.results, await resourceChoices(c, id)));
});

productionRoutes.post("/admin/productions/:id/edit", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const theme = form.has("theme_color") ? String(form.get("theme_color") || "").trim() : null;
  if (theme && !validAccent(theme)) return c.text("作品颜色请填写 #RRGGBB 格式。", 400);
  const id = Number(c.req.param("id"));
  const title = String(form.get("title") ?? "").trim();
  const yearText = String(form.get("year") ?? "").trim();
  const year = yearText ? Number(yearText) : null;
  const resourceIds = selectedResourceIds(form);
  if (
    !title ||
    !resourceIds ||
    title.length > 100 ||
    (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
  )
    return c.text("请检查作品名称和年份。", 400);
  const coverText = String(form.get("cover_id") ?? "");
  const cover = coverText ? Number(coverText) : null;
  if (cover !== null && !resourceIds.includes(cover)) return c.text("作品封面必须同时保留在关联资料中。", 400);
  const allowed = await resourceChoices(c, id);
  const allowedIds = new Set(allowed.map((resource) => resource.id));
  if (!resourceIds.every((resourceId) => allowedIds.has(resourceId)))
    return c.text("选择的资料已被其他作品使用。", 409);
  if (
    cover !== null &&
    !(await c.env.DB.prepare(
      "SELECT id FROM resource WHERE id=? AND production_id=? AND status='approved' AND res_type='photo'",
    )
      .bind(cover, id)
      .first())
  )
    return c.text("封面必须选择该作品已审核的剧照。", 400);
  const result = await c.env.DB.prepare(
    "UPDATE production SET title=?,synopsis=?,promo=?,year=COALESCE(?,year),cover_ratio=?,feature_layout=?,cover_id=?,theme_color=COALESCE(?,theme_color) WHERE id=?",
  )
    .bind(
      title,
      String(form.get("synopsis") ?? "").trim(),
      String(form.get("promo") ?? "")
        .trim()
        .slice(0, 300),
      year,
      form.get("cover_ratio") === "portrait" ? "portrait" : "landscape",
      form.get("feature_layout") === "overlay" ? "overlay" : "split",
      cover,
      theme,
      id,
    )
    .run();
  if (result.meta.changes !== 1) return c.text("未找到这部作品。", 404);
  const detach = resourceIds.length
    ? c.env.DB.prepare(
        `UPDATE resource SET production_id=NULL WHERE production_id=? AND id NOT IN (${resourceIds.map(() => "?").join(",")})`,
      ).bind(id, ...resourceIds)
    : c.env.DB.prepare("UPDATE resource SET production_id=NULL WHERE production_id=?").bind(id);
  await c.env.DB.batch([
    detach,
    ...resourceIds.map((resourceId) =>
      c.env.DB.prepare(
        "UPDATE resource SET production_id=? WHERE id=? AND status IN ('pending','approved') AND (production_id IS NULL OR production_id=?)",
      ).bind(id, resourceId, id),
    ),
  ]);
  return c.redirect(`/productions/${id}`, 303);
});

productionRoutes.post("/admin/productions/:id/delete", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const id = Number(c.req.param("id"));
  const production = await c.env.DB.prepare("SELECT title FROM production WHERE id=?")
    .bind(id)
    .first<{ title: string }>();
  if (!production) return c.text("未找到这部作品。", 404);
  if (String(form.get("confirm_title") ?? "").trim() !== production.title)
    return c.text("作品名不一致，未执行删除。", 400);
  await c.env.DB.prepare("DELETE FROM production WHERE id=?").bind(id).run();
  return c.redirect("/productions?deleted=1", 303);
});

productionRoutes.post("/admin/productions/:id/credits", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const productionId = Number(c.req.param("id"));
  const editionId = await selectedEdition(c, form, productionId);
  if (!editionId) return c.text("请选择本作品的演出版本。", 400);
  const ids = form.getAll("member_id").map(Number),
    roles = form.getAll("role_name").map((v) => String(v).trim()),
    kinds = form.getAll("kind").map(String);
  if (
    !ids.length ||
    ids.length > 50 ||
    ids.length !== roles.length ||
    ids.length !== kinds.length ||
    ids.some(
      (id, i) =>
        !Number.isSafeInteger(id) ||
        id < 1 ||
        !roles[i] ||
        roles[i].length > 80 ||
        !["cast", "crew"].includes(kinds[i]),
    )
  )
    return c.text("请为每一行选择队员、类别并填写角色或分工，一次最多 50 条。", 400);
  if (new Set(ids.map((id, i) => `${id}:${kinds[i]}:${roles[i].toLocaleLowerCase()}`)).size !== ids.length)
    return c.text("表单中有重复的演职员记录，请合并后提交。", 400);
  const members = await c.env.DB.prepare("SELECT id FROM member WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: number }>();
  if (new Set(members.results.map((m) => m.id)).size !== new Set(ids).size)
    return c.text("部分队员档案已不存在，请重新选择。", 400);
  try {
    await c.env.DB.batch(
      ids.map((id, i) =>
        c.env.DB.prepare(
          "INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) VALUES(?,?,?,?,?)",
        ).bind(productionId, editionId, id, kinds[i], roles[i]),
      ),
    );
  } catch (error) {
    if (/UNIQUE/.test(String(error)))
      return c.text("本版本已有相同演职员记录，本次未添加任何一行，请检查后重试。", 409);
    throw error;
  }
  return c.redirect(`/productions/${productionId}`, 303);
});

productionRoutes.get("/admin/production-requests", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.user_id,u.username,r.member_id,m.name member_name,r.production_id,p.title production_title,
    r.kind,r.role_name,r.status,r.admin_note,r.created_at,(SELECT COALESCE(year,'')||' · '||name FROM production_edition WHERE id=r.edition_id) edition_name,
    COALESCE((SELECT group_concat(m2.name,'、') FROM production_credit pc2 JOIN member m2 ON m2.id=pc2.member_id
      WHERE pc2.production_id=r.production_id AND pc2.edition_id IS r.edition_id AND pc2.kind=r.kind AND pc2.role_name=r.role_name COLLATE NOCASE),'') existing_names
    FROM production_join_request r
    JOIN user u ON u.id=r.user_id JOIN member m ON m.id=r.member_id JOIN production p ON p.id=r.production_id
    WHERE r.status='pending' ORDER BY r.created_at,r.id`,
  ).all<ProductionJoinRequestRow>();
  return c.html(productionRequestsPage(rows.results, await csrfFor(c)));
});

productionRoutes.post("/admin/production-requests/:id/review", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
  const id = Number(c.req.param("id"));
  const decision = form.get("decision") === "approve" ? "approved" : "rejected";
  const note = String(form.get("admin_note") ?? "").trim();
  if (decision === "rejected" && !note) return c.text("驳回时必须填写理由。", 400);
  await reviewRequest(c.env.DB, "production-join", id, c.get("user")!.id, decision, note);
  return c.redirect("/admin/production-requests", 303);
});

productionRoutes.post("/admin/productions/:id/credits/:creditId/delete", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  await c.env.DB.prepare("DELETE FROM production_credit WHERE id=? AND production_id=?")
    .bind(Number(c.req.param("creditId")), Number(c.req.param("id")))
    .run();
  return c.redirect(`/productions/${c.req.param("id")}`, 303);
});
