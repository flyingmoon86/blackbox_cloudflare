import { certified } from "../../services/member-records";
import { pageNumber } from "../../views/shared";
import { productionVisible } from "../../services/production-visibility";
import { Hono } from "hono";
import { csrfFor } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { memberDetailPage, memberListPage } from "../../views/members";
import type { MemberRow } from "../../services/members/types";
import { memberFilter, memberContextQuery } from "../../services/members/queries";

export function registerPublicMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.get("/members", async (c) => {
    const { search, year, condition, params } = memberFilter(c);
    const total =
      (
        await c.env.DB.prepare(`SELECT COUNT(*) n FROM member m ${condition}`)
          .bind(...params)
          .first<{ n: number }>()
      )?.n || 0;
    const size = 25,
      page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
    const result = await c.env.DB.prepare(
      `SELECT m.id, m.name, m.bio, m.join_year, m.cohort, m.works, m.photo, EXISTS(SELECT 1 FROM site_contributor sc LEFT JOIN user cu ON cu.id=sc.user_id WHERE (sc.member_id=m.id OR cu.member_id=m.id) AND sc.revoked_at IS NULL AND sc.public_consent=1) contributor,
    COUNT(f.id) + (SELECT COUNT(*) FROM visitor_flower vf WHERE vf.member_id=m.id) AS flower_count FROM member m LEFT JOIN flower f ON f.member_id = m.id ${condition}
    GROUP BY m.id ORDER BY flower_count DESC,m.join_year DESC, m.name COLLATE NOCASE,m.id LIMIT ? OFFSET ?`,
    )
      .bind(...params, size, (page - 1) * size)
      .all<MemberRow>();
    return c.html(
      memberListPage(result.results, search, year, c.get("user")?.role === "admin", Boolean(c.get("user")), {
        page,
        size,
        total,
        path: "/members",
        query: search,
        year,
      }),
    );
  });

  memberRoutes.get("/members/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.text("未找到队员档案。", 404);
    const member = await c.env.DB.prepare(
      `SELECT m.id, m.name, m.bio, m.join_year, m.cohort, m.works, m.photo, EXISTS(SELECT 1 FROM site_contributor sc LEFT JOIN user cu ON cu.id=sc.user_id WHERE (sc.member_id=m.id OR cu.member_id=m.id) AND sc.revoked_at IS NULL AND sc.public_consent=1) contributor,
    COUNT(f.id) + (SELECT COUNT(*) FROM visitor_flower vf WHERE vf.member_id=m.id) AS flower_count FROM member m LEFT JOIN flower f ON f.member_id = m.id WHERE m.id = ? GROUP BY m.id`,
    )
      .bind(id)
      .first<MemberRow>();
    if (!member) return c.text("未找到队员档案。", 404);
    member.flower_senders = (
      await c.env.DB.prepare(
        "SELECT COALESCE(NULLIF(m.name,''),u.username) name,u.member_id,COUNT(*) amount FROM flower f JOIN user u ON u.id=f.user_id LEFT JOIN member m ON m.id=u.member_id WHERE f.member_id=? GROUP BY u.id ORDER BY amount DESC,u.id",
      )
        .bind(id)
        .all<{ name: string; member_id: number | null; amount: number }>()
    ).results;
    member.anonymous_flowers = Math.max(
      0,
      member.flower_count - member.flower_senders.reduce((sum, sender) => sum + sender.amount, 0),
    );
    member.productions = (
      await c.env.DB.prepare(
        `SELECT p.id,p.title,pc.edition_id,pe.name edition_name,pe.year,pc.role_name,pc.kind FROM production p JOIN production_credit pc ON pc.production_id=p.id LEFT JOIN production_edition pe ON pe.id=pc.edition_id WHERE pc.member_id=? AND ${productionVisible(c, "p")} ORDER BY pe.year DESC,p.id DESC,pc.edition_id DESC,pc.kind,pc.id`,
      )
        .bind(id)
        .all<NonNullable<MemberRow["productions"]>[number]>()
    ).results;
    const { search, year, condition, params } = memberFilter(c);
    const nearby = await c.env.DB.prepare(
      `WITH candidates AS (
    SELECT m.id,m.name,m.join_year,COUNT(f.id)+(SELECT COUNT(*) FROM visitor_flower vf WHERE vf.member_id=m.id) flower_count
    FROM member m LEFT JOIN flower f ON f.member_id=m.id ${condition} GROUP BY m.id
  ), ordered AS (
    SELECT id,name,ROW_NUMBER() OVER (ORDER BY flower_count DESC,join_year DESC,name COLLATE NOCASE,id) position FROM candidates
  ) SELECT id,name,position FROM ordered WHERE position BETWEEN
    (SELECT position-1 FROM ordered WHERE id=?) AND (SELECT position+1 FROM ordered WHERE id=?) ORDER BY position`,
    )
      .bind(...params, id, id)
      .all<{ id: number; name: string; position: number }>();
    const current = nearby.results.find((row) => row.id === id);
    const page = c.req.query("page") ? pageNumber(c.req.query("page")) : Math.ceil((current?.position || 1) / 25);
    const context = memberContextQuery({ search, year }, page);
    const navigation = {
      back: `/members?${context}`,
      previous: nearby.results.find((row) => current && row.position === current.position - 1),
      next: nearby.results.find((row) => current && row.position === current.position + 1),
      query: context.toString(),
    };
    const user = c.get("user");
    if (certified(user))
      member.featured_photos = (
        await c.env.DB.prepare(
          "SELECT id,caption FROM member_featured_photo WHERE member_id=? AND archived=0 AND status='approved' AND members_consent=1 ORDER BY updated_at DESC,id DESC",
        )
          .bind(id)
          .all<{ id: string; caption: string }>()
      ).results;
    return c.html(
      memberDetailPage(
        member,
        await csrfFor(c),
        c.req.query("flower") ?? "",
        user?.member_id === id,
        user?.role === "admin",
        Boolean(user),
        navigation,
      ),
    );
  });
}
