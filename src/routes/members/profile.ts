import { Hono } from "hono";
import { csrfFor, csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { memberEditPage } from "../../views/members";
import type { MemberRow } from "../../services/members/types";

export function registerProfileMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.get("/profile/member", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "member" || !user.member_id) return c.redirect("/profile");
    const member = await c.env.DB.prepare(
      "SELECT id,name,bio,join_year,cohort,works,photo,0 flower_count FROM member WHERE id=?",
    )
      .bind(user.member_id)
      .first<MemberRow>();
    return member
      ? c.html(memberEditPage(member, await csrfFor(c), false, c.req.query("saved") === "1"))
      : c.text("未找到队员档案。", 404);
  });

  memberRoutes.post("/profile/member", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "member" || !user.member_id) return c.text("只有已认证队员能修改自己的信息。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const bio = String(form.get("bio") ?? "").trim();
    if (bio.length > 5000) return c.text("简介内容过长。", 400);
    const year = String(form.get("join_year") || "").trim(),
      cohort = String(form.get("cohort") || "").trim();
    if ((year && !/^(19|20)[0-9]{2}$/.test(year)) || (cohort && !/^(19|20)[0-9]{2}$/.test(cohort)))
      return c.text("入队年份和入学年级请填写四位年份，例如 2024。", 400);
    await c.env.DB.prepare(
      "UPDATE member SET bio=?,join_year=COALESCE(?,join_year),cohort=CASE WHEN ?=\'\' THEN cohort ELSE ? END WHERE id=?",
    )
      .bind(bio, year ? Number(year) : null, cohort, cohort, user.member_id)
      .run();
    return c.redirect("/profile/member?saved=1", 303);
  });
}
