import { consumeAccountLimit } from "../../middleware/request-limits";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { memberApplicationPage } from "../../views/members";

export function registerApplicationsMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.get("/profile/member-application", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "user") return c.redirect("/profile");
    const pending = await c.env.DB.prepare(
      "SELECT id, apply_type, name FROM join_request WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1",
    )
      .bind(user.id)
      .first();
    const mode = c.req.query("type") === "new" ? "new" : "bind";
    const available =
      mode === "bind"
        ? await c.env.DB.prepare(
            `SELECT m.id, m.name, m.cohort,m.join_year FROM member m LEFT JOIN user u ON u.member_id = m.id
    WHERE u.id IS NULL ORDER BY COALESCE(NULLIF(CAST(m.cohort AS INTEGER),0),m.join_year,0) DESC, m.name COLLATE NOCASE,m.id`,
          ).all<{ id: number; name: string; cohort: string; join_year: number | null }>()
        : { results: [] };
    return c.html(memberApplicationPage(await csrfFor(c), mode, available.results, pending));
  });

  memberRoutes.post("/profile/member-application", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "user") return c.redirect("/profile");
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    if (
      await c.env.DB.prepare("SELECT id FROM join_request WHERE user_id = ? AND status = 'pending'")
        .bind(user.id)
        .first()
    )
      return c.text("你已有待审核申请。", 409);
    const retry = await consumeAccountLimit(c, "member-request", 6);
    if (retry) {
      c.header("Retry-After", String(retry));
      return c.text("申请次数较多，请稍后重试。", 429);
    }
    const mode = form.get("apply_type") === "new" ? "new" : "bind";
    const identity = String(form.get("identity_note") ?? "").trim();
    if (identity.length < 1 || identity.length > 1000) return c.text("请填写 1–1000 字的参与经历。", 400);
    if (mode === "bind") {
      const memberId = Number(form.get("member_id"));
      const available =
        Number.isInteger(memberId) &&
        (await c.env.DB.prepare(
          "SELECT m.id FROM member m LEFT JOIN user u ON u.member_id=m.id WHERE m.id=? AND u.id IS NULL",
        )
          .bind(memberId)
          .first());
      if (!available) return c.text("请选择尚未绑定账号的队员档案。", 400);
      await c.env.DB.prepare(
        "INSERT INTO join_request (user_id, apply_type, identity_note, member_id) VALUES (?, 'bind', ?, ?) ON CONFLICT(user_id) WHERE status='pending' DO NOTHING",
      )
        .bind(user.id, identity, memberId)
        .run();
    } else {
      const name = String(form.get("name") ?? "").trim();
      const yearText = String(form.get("join_year") ?? "").trim();
      const year = yearText ? Number(yearText) : null;
      const cohort = String(form.get("cohort") ?? "")
        .trim()
        .slice(0, 20);
      const bio = String(form.get("bio") ?? "")
        .trim()
        .slice(0, 5000);
      if (
        (cohort && !/^(19|20)[0-9]{2}$/.test(cohort)) ||
        !name ||
        name.length > 50 ||
        (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
      )
        return c.text("请检查姓名和入队年份。", 400);
      await c.env.DB.prepare(
        "INSERT INTO join_request (user_id, apply_type, identity_note, name, bio, join_year, cohort) VALUES (?, 'new', ?, ?, ?, ?, ?) ON CONFLICT(user_id) WHERE status='pending' DO NOTHING",
      )
        .bind(user.id, identity, name, bio, year, cohort)
        .run();
    }
    return c.redirect("/profile/member-application", 303);
  });
}
