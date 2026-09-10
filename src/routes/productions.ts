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
  id: number;
  member_id: number;
  member_name: string;
  kind: "cast" | "crew";
  role_name: string;
};
export type MemberChoice = { id: number; name: string; cohort: string };
export type ProductionResourceRow = {
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

productionRoutes.use("*", async (c, next) => {
  if (!c.req.path.startsWith("/productions") && !c.req.path.startsWith("/admin/production")) return next();
  if (!c.get("user")) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
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
  const result = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production ORDER BY year DESC,id DESC",
  ).all<ProductionRow>();
  return c.html(productionListPage(result.results, c.get("user")!, c.req.query("deleted") === "1"));
});

productionRoutes.get("/productions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const production = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production WHERE id=?",
  )
    .bind(id)
    .first<ProductionRow>();
  if (!production) return c.text("未找到这部作品。", 404);
  const credits = await c.env.DB.prepare(
    `SELECT pc.id,pc.member_id,m.name AS member_name,pc.kind,pc.role_name FROM production_credit pc
    JOIN member m ON m.id=pc.member_id WHERE pc.production_id=? ORDER BY pc.kind,pc.id`,
  )
    .bind(id)
    .all<CreditRow>();
  const resources = await c.env.DB.prepare(
    `SELECT id,title,res_type,description,original_name,preview_filename FROM resource
    WHERE production_id=? AND status='approved' ORDER BY created_at DESC,id DESC`,
  )
    .bind(id)
    .all<ProductionResourceRow>();
  const user = c.get("user")!;
  const admin = user.role === "admin";
  const myRequests = user.member_id
    ? await c.env.DB.prepare(
        "SELECT status,kind,role_name,admin_note FROM production_join_request WHERE user_id=? AND production_id=? AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 8",
      )
        .bind(user.id, id)
        .all<{ status: string; kind: string; role_name: string; admin_note: string }>()
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
    ),
  );
});

productionRoutes.post("/productions/:id/join", async (c) => {
  const user = c.get("user")!;
  if (user.role === "user" || !user.member_id) return c.text("只有认证队员可以申请加入作品。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
  const productionId = Number(c.req.param("id"));
  const kind = form.get("kind") === "crew" ? "crew" : "cast";
  const roleName = String(form.get("role_name") ?? "").trim();
  if (!roleName || roleName.length > 80) return c.text("请填写 1–80 字的角色或分工。", 400);
  if (!(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(productionId).first()))
    return c.text("作品不存在。", 404);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM production_credit WHERE production_id=? AND member_id=? AND kind=? AND role_name=? COLLATE NOCASE LIMIT 1",
    )
      .bind(productionId, user.member_id, kind, roleName)
      .first()
  )
    return c.text("这条角色或分工已经在演职员名单中，可以继续申请其他角色。", 409);
  try {
    await c.env.DB.prepare(
      "INSERT INTO production_join_request(user_id,member_id,production_id,kind,role_name) VALUES(?,?,?,?,?)",
    )
      .bind(user.id, user.member_id, productionId, kind, roleName)
      .run();
  } catch {
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
  const allowed = await resourceChoices(c, null);
  const allowedIds = new Set(allowed.map((resource) => resource.id));
  if (!resourceIds.every((id) => allowedIds.has(id))) return c.text("选择的资料已被其他作品使用。", 409);
  const result = await c.env.DB.prepare(
    "INSERT INTO production(title,synopsis,promo,year,cover_ratio,feature_layout) VALUES(?,?,?,?,?,?)",
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
    )
    .run();
  const productionId = Number(result.meta.last_row_id);
  if (resourceIds.length)
    await c.env.DB.batch(
      resourceIds.map((resourceId) =>
        c.env.DB.prepare(
          "UPDATE resource SET production_id=? WHERE id=? AND status IN ('pending','approved') AND production_id IS NULL",
        ).bind(productionId, resourceId),
      ),
    );
  return c.redirect(`/productions/${productionId}`, 303);
});

productionRoutes.get("/admin/productions/:id/edit", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const id = Number(c.req.param("id"));
  const production = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production WHERE id=?",
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
    "UPDATE production SET title=?,synopsis=?,promo=?,year=?,cover_ratio=?,feature_layout=?,cover_id=? WHERE id=?",
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
  const memberId = Number(form.get("member_id"));
  const roleName = String(form.get("role_name") ?? "").trim();
  const kind = form.get("kind") === "crew" ? "crew" : "cast";
  if (
    !roleName ||
    roleName.length > 80 ||
    !(await c.env.DB.prepare("SELECT id FROM member WHERE id=?").bind(memberId).first())
  )
    return c.text("请选择队员并填写分工。", 400);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM production_credit WHERE production_id=? AND member_id=? AND kind=? AND role_name=? COLLATE NOCASE LIMIT 1",
    )
      .bind(productionId, memberId, kind, roleName)
      .first()
  )
    return c.text("这位队员已经登记了相同的角色或分工。", 409);
  await c.env.DB.prepare("INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(?,?,?,?)")
    .bind(productionId, memberId, kind, roleName)
    .run();
  return c.redirect(`/productions/${productionId}`, 303);
});

productionRoutes.get("/admin/production-requests", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const rows = await c.env.DB.prepare(
    `SELECT r.id,r.user_id,u.username,r.member_id,m.name member_name,r.production_id,p.title production_title,
    r.kind,r.role_name,r.status,r.admin_note,r.created_at,
    COALESCE((SELECT group_concat(m2.name,'、') FROM production_credit pc2 JOIN member m2 ON m2.id=pc2.member_id
      WHERE pc2.production_id=r.production_id AND pc2.kind=r.kind AND pc2.role_name=r.role_name COLLATE NOCASE),'') existing_names
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
  const request = await c.env.DB.prepare(
    "SELECT member_id,production_id,kind,role_name FROM production_join_request WHERE id=? AND status='pending'",
  )
    .bind(id)
    .first<{ member_id: number; production_id: number; kind: string; role_name: string }>();
  if (!request) return c.text("申请不存在或已处理。", 404);
  if (decision === "approved") {
    const exists = await c.env.DB.prepare(
      "SELECT id FROM production_credit WHERE production_id=? AND member_id=? AND kind=? AND role_name=?",
    )
      .bind(request.production_id, request.member_id, request.kind, request.role_name)
      .first();
    const statements = [];
    if (!exists)
      statements.push(
        c.env.DB.prepare("INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(?,?,?,?)").bind(
          request.production_id,
          request.member_id,
          request.kind,
          request.role_name,
        ),
      );
    statements.push(
      c.env.DB.prepare(
        "UPDATE production_join_request SET status='approved',admin_note=? WHERE id=? AND status='pending'",
      ).bind(note, id),
    );
    await c.env.DB.batch(statements);
  } else {
    await c.env.DB.prepare(
      "UPDATE production_join_request SET status='rejected',admin_note=? WHERE id=? AND status='pending'",
    )
      .bind(note, id)
      .run();
  }
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
