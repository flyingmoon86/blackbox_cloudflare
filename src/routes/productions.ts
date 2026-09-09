import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import { productionDetailPage, productionFormPage, productionListPage } from "../views/productions";

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

export const productionRoutes = new Hono<AppEnv>();

productionRoutes.use("*", async (c, next) => {
  if (!c.get("user")) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

function adminOnly(c: any): Response | null {
  return c.get("user")?.role === "admin" ? null : c.text("没有管理员权限。", 403);
}

productionRoutes.get("/productions", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout FROM production ORDER BY year DESC,id DESC",
  ).all<ProductionRow>();
  return c.html(productionListPage(result.results, c.get("user")!.role === "admin"));
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
  const admin = c.get("user")!.role === "admin";
  const members = admin
    ? await c.env.DB.prepare(
        "SELECT id,name,cohort FROM member ORDER BY join_year DESC,name COLLATE NOCASE",
      ).all<MemberChoice>()
    : { results: [] };
  return c.html(productionDetailPage(production, credits.results, members.results, admin, await csrfFor(c)));
});

productionRoutes.get("/admin/productions/new", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  return c.html(productionFormPage(null, await csrfFor(c), []));
});

productionRoutes.post("/admin/productions/new", async (c) => {
  const denied = adminOnly(c);
  if (denied) return denied;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const title = String(form.get("title") ?? "").trim();
  const yearText = String(form.get("year") ?? "").trim();
  const year = yearText ? Number(yearText) : null;
  if (!title || title.length > 100 || (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)))
    return c.text("请检查作品名称和年份。", 400);
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
  return c.redirect(`/productions/${result.meta.last_row_id}`, 303);
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
  return c.html(productionFormPage(production, await csrfFor(c), covers.results));
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
  if (!title || title.length > 100 || (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)))
    return c.text("请检查作品名称和年份。", 400);
  const coverText = String(form.get("cover_id") ?? "");
  const cover = coverText ? Number(coverText) : null;
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
  return c.redirect(`/productions/${id}`, 303);
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
  await c.env.DB.prepare("INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(?,?,?,?)")
    .bind(productionId, memberId, kind, roleName)
    .run();
  return c.redirect(`/productions/${productionId}`, 303);
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
