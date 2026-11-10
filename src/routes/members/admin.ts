import { queueCurrentAvatar } from "../../services/avatars";
import { drainFileCleanup } from "../../services/file-cleanup";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { memberCreatePage, memberEditPage } from "../../views/members";
import type { MemberRow } from "../../services/members/types";
import { memberNameTaken } from "../../services/members/queries";

export function registerAdminMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.get("/admin/members/new", async (c) => {
    if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
    return c.html(memberCreatePage(await csrfFor(c)));
  });

  memberRoutes.post("/admin/members/new", async (c) => {
    if (c.get("user")!.role !== "admin") return c.text("没有管理员权限。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const name = String(form.get("name") ?? "").trim();
    const yearText = String(form.get("join_year") ?? "").trim();
    const year = yearText ? Number(yearText) : null;
    const cohort = String(form.get("cohort") ?? "").trim();
    const bio = String(form.get("bio") ?? "").trim();
    if (
      !name ||
      name.length > 50 ||
      (cohort !== "" && !/^(19|20)[0-9]{2}$/.test(cohort)) ||
      bio.length > 5000 ||
      (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
    )
      return c.html(memberCreatePage(await csrfFor(c), "请检查姓名、年份和文字长度。"), 400);
    if (await memberNameTaken(c.env.DB, name))
      return c.html(memberCreatePage(await csrfFor(c), "已有同名队员档案，请核对后再建立。"), 409);
    const result = await c.env.DB.prepare("INSERT INTO member(name,bio,join_year,cohort) VALUES(?,?,?,?)")
      .bind(name, bio, year, cohort)
      .run();
    return c.redirect(`/admin/members/${Number(result.meta.last_row_id)}/edit?created=1`, 303);
  });

  memberRoutes.get("/admin/members/:id/edit", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "admin") return c.text("没有管理员权限。", 403);
    const member = await c.env.DB.prepare(
      "SELECT id,name,bio,join_year,cohort,works,photo,0 flower_count FROM member WHERE id=?",
    )
      .bind(Number(c.req.param("id")))
      .first<MemberRow>();
    return member
      ? c.html(
          memberEditPage(
            member,
            await csrfFor(c),
            true,
            c.req.query("saved") === "1" || c.req.query("created") === "1",
          ),
        )
      : c.text("未找到队员档案。", 404);
  });

  memberRoutes.post("/admin/members/:id/edit", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "admin") return c.text("没有管理员权限。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const id = Number(c.req.param("id"));
    const name = String(form.get("name") ?? "").trim();
    const yearText = String(form.get("join_year") ?? "").trim();
    const year = yearText ? Number(yearText) : null;
    const cohort = String(form.get("cohort") ?? "").trim();
    const bio = String(form.get("bio") ?? "").trim();
    if (
      !name ||
      name.length > 50 ||
      (cohort !== "" && !/^(19|20)[0-9]{2}$/.test(cohort)) ||
      bio.length > 5000 ||
      (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
    )
      return c.html(
        memberEditPage(
          { id, name, bio, join_year: year, cohort, works: "", photo: "", flower_count: 0 },
          await csrfFor(c),
          true,
          false,
          "请检查队员档案内容。",
        ),
        400,
      );
    if (await memberNameTaken(c.env.DB, name, id))
      return c.html(
        memberEditPage(
          { id, name, bio, join_year: year, cohort, works: "", photo: "", flower_count: 0 },
          await csrfFor(c),
          true,
          false,
          "已有同名队员档案，请修改姓名后再保存。",
        ),
        409,
      );
    const result = await c.env.DB.prepare(
      "UPDATE member SET name=?,join_year=COALESCE(?,join_year),cohort=CASE WHEN ?='' THEN cohort ELSE ? END,bio=? WHERE id=?",
    )
      .bind(name, year, cohort, cohort, bio, id)
      .run();
    if (result.meta.changes !== 1) return c.text("未找到队员档案。", 404);
    return c.redirect(`/admin/members/${id}/edit?saved=1`, 303);
  });

  memberRoutes.post("/admin/members/:id/delete", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "admin") return c.text("没有管理员权限。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) return c.text("未找到队员档案。", 404);
    const confirmName = String(form.get("confirm_name") ?? "").trim();
    const member = await c.env.DB.prepare("SELECT id,name FROM member WHERE id=?")
      .bind(id)
      .first<{ id: number; name: string }>();
    if (!member) return c.text("未找到队员档案。", 404);
    if (confirmName !== member.name.trim()) return c.text("请输入完全一致的档案姓名以确认删除。", 400);
    if (await c.env.DB.prepare("SELECT id FROM member_record WHERE member_id=? LIMIT 1").bind(id).first())
      return c.text("该档案有受限资料或审计历史，暂不支持永久删除；请先归档相关记录，历史资料继续保留。", 409);
    if (await c.env.DB.prepare("SELECT id FROM member_featured_photo WHERE member_id=? LIMIT 1").bind(id).first())
      return c.text("该档案有精选照片和审计历史，请先归档，暂不支持永久删除。", 409);
    await c.env.DB.batch([queueCurrentAvatar(c.env, id), c.env.DB.prepare("DELETE FROM member WHERE id=?").bind(id)]);
    await drainFileCleanup(c.env);
    return c.redirect("/members?deleted=1", 303);
  });
}
