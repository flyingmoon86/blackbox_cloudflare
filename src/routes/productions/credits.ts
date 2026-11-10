import { consumeAccountLimit } from "../../middleware/request-limits";
import { reviewRequest } from "../../services/reviews";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { productionRequestsPage } from "../../views/productions";
import type { ProductionJoinRequestRow } from "../../services/productions/types";
import { selectedEdition } from "../../services/productions/queries";
import { adminOnly } from "../../http/authorization";

export function registerCreditsRoutes(productionRoutes: Hono<AppEnv>) {
  productionRoutes.post("/productions/:id/join", async (c) => {
    const user = c.get("user")!;
    if (user.role === "user" || !user.member_id) return c.text("只有认证队员可以申请加入作品。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
    const productionId = Number(c.req.param("id"));
    const editionId = await selectedEdition(c.env.DB, form, productionId);
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

  productionRoutes.post("/admin/productions/:id/credits", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const productionId = Number(c.req.param("id"));
    const editionId = await selectedEdition(c.env.DB, form, productionId);
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
}
