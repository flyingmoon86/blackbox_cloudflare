import { reviewRequest } from "../services/reviews";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import { adminDashboardPage } from "../views/admin";

export type JoinReview = {
  id: number;
  user_id: number;
  username: string;
  apply_type: "bind" | "new";
  identity_note: string;
  member_id: number | null;
  member_name: string | null;
  name: string;
  bio: string;
  join_year: number | null;
  cohort: string;
  created_at: string;
};

export type ManagedUser = {
  id: number;
  username: string;
  email: string | null;
  role: "user" | "member" | "admin";
  status: "active" | "disabled";
  member_id: number | null;
  member_name: string | null;
};

export type PendingCounts = {
  member_requests: number;
  production_joins: number;
  resource_reviews: number;
  production_creates: number;
  website_suggestions: number;
};

type NotificationGroup = {
  kind: "member" | "production-join" | "resource" | "production-create" | "suggestion";
  count: number;
  newest_id: number;
};

export const adminRoutes = new Hono<AppEnv>();

const requireAdmin = async (c: any, next: () => Promise<void>) => {
  const user = c.get("user");
  if (!user) return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  if (user.role !== "admin") return c.text("没有管理员权限。", 403);
  await next();
};

adminRoutes.use("/admin", requireAdmin);
adminRoutes.use("/admin/*", requireAdmin);

adminRoutes.get("/admin", async (c) => {
  const [requests, users, counts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT r.id,r.user_id,u.username,r.apply_type,r.identity_note,r.member_id,m.name AS member_name,
      r.name,r.bio,r.join_year,r.cohort,r.created_at FROM join_request r JOIN user u ON u.id=r.user_id
      LEFT JOIN member m ON m.id=r.member_id WHERE r.status='pending' ORDER BY r.created_at`,
    ).all<JoinReview>(),
    c.env.DB.prepare(
      `SELECT u.id,u.username,u.email,u.role,u.status,u.member_id,m.name AS member_name FROM user u
      LEFT JOIN member m ON m.id=u.member_id ORDER BY u.id DESC LIMIT 200`,
    ).all<ManagedUser>(),
    c.env.DB.prepare(
      `SELECT
      (SELECT COUNT(*) FROM join_request WHERE status='pending') member_requests,
      (SELECT COUNT(*) FROM production_join_request WHERE status='pending') production_joins,
      (SELECT COUNT(*) FROM resource WHERE status='pending') resource_reviews,
      (SELECT COUNT(*) FROM suggestion WHERE status='open' AND category='production') production_creates,
      (SELECT COUNT(*) FROM suggestion WHERE status='open' AND category='website') website_suggestions`,
    ).first<PendingCounts>(),
  ]);
  return c.html(
    adminDashboardPage(
      requests.results,
      users.results,
      counts || {
        member_requests: 0,
        production_joins: 0,
        resource_reviews: 0,
        production_creates: 0,
        website_suggestions: 0,
      },
      c.get("user")!.id,
      await csrfFor(c),
      c.req.query("message") ?? "",
    ),
  );
});

adminRoutes.get("/admin/notifications", async (c) => {
  const user = c.get("user")!;
  const [groups, reads] = await Promise.all([
    c.env.DB.prepare(
      `SELECT 'member' kind,COUNT(*) count,COALESCE(MAX(id),0) newest_id FROM join_request WHERE status='pending'
      UNION ALL SELECT 'production-join',COUNT(*),COALESCE(MAX(id),0) FROM production_join_request WHERE status='pending'
      UNION ALL SELECT 'resource',COUNT(*),COALESCE(MAX(id),0) FROM resource WHERE status='pending'
      UNION ALL SELECT 'production-create',COUNT(*),COALESCE(MAX(id),0) FROM suggestion WHERE status='open' AND category='production'
      UNION ALL SELECT 'suggestion',COUNT(*),COALESCE(MAX(id),0) FROM suggestion WHERE status='open' AND category='website'`,
    ).all<NotificationGroup>(),
    c.env.DB.prepare("SELECT notification_key FROM admin_notification_read WHERE user_id=?")
      .bind(user.id)
      .all<{ notification_key: string }>(),
  ]);
  const seen = new Set(reads.results.map((row) => row.notification_key));
  const labels: Record<NotificationGroup["kind"], { title: string; href: string }> = {
    member: { title: "新队员认证申请", href: "/admin#member-requests" },
    "production-join": { title: "新作品加入申请", href: "/admin/production-requests" },
    resource: { title: "新资料等待审核", href: "/admin/resources/reviews" },
    "production-create": { title: "新作品建档申请", href: "/admin/suggestions" },
    suggestion: { title: "新网站建议", href: "/admin/suggestions" },
  };
  const unread = groups.results
    .filter((group) => group.count > 0)
    .map((group) => ({
      key: `${group.kind}:${group.newest_id}`,
      count: group.count,
      ...labels[group.kind],
    }))
    .filter((item) => !seen.has(item.key));
  return c.json({
    csrf: await csrfFor(c),
    total: unread.reduce((sum, item) => sum + item.count, 0),
    hidden: Math.max(0, unread.length - 4),
    items: unread.slice(0, 4),
  });
});

adminRoutes.post("/admin/notifications/dismiss", async (c) => {
  const user = c.get("user")!;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.json({ error: "请求已失效，请刷新后重试。" }, 400);
  const key = String(form.get("key") ?? "");
  if (!/^(member|production-join|resource|production-create|suggestion):\d+$/.test(key))
    return c.json({ error: "通知不存在。" }, 400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO admin_notification_read(user_id,notification_key) VALUES(?,?)")
    .bind(user.id, key)
    .run();
  return c.json({ ok: true });
});

adminRoutes.post("/admin/requests/:id/approve", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  await reviewRequest(c.env.DB, "member", Number(c.req.param("id")), c.get("user")!.id, "approved");
  return c.redirect("/admin?message=approved", 303);
});

adminRoutes.post("/admin/requests/:id/reject", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const note = String(form.get("admin_note") ?? "").trim();
  if (note.length < 1 || note.length > 1000) return c.text("请填写 1–1000 字的驳回理由。", 400);
  await reviewRequest(c.env.DB, "member", Number(c.req.param("id")), c.get("user")!.id, "rejected", note);
  return c.redirect("/admin?message=rejected", 303);
});

adminRoutes.post("/admin/users/:id/toggle", async (c) => {
  const admin = c.get("user")!;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const id = Number(c.req.param("id"));
  if (id === admin.id) return c.text("不能禁用当前登录的管理员账号。", 400);
  const result = await c.env.DB.prepare(
    `UPDATE user SET status=CASE status WHEN 'active' THEN 'disabled' ELSE 'active' END,
    auth_version=auth_version+1 WHERE id=?`,
  )
    .bind(id)
    .run();
  if (result.meta.changes !== 1) return c.text("账号不存在。", 404);
  return c.redirect("/admin?message=user-updated", 303);
});

adminRoutes.post("/admin/users/:id/unlink-member", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  if (form.get("confirm_unlink") !== "yes") return c.text("请先确认解绑操作。", 400);
  const id = Number(c.req.param("id"));
  const target = await c.env.DB.prepare("SELECT role,member_id FROM user WHERE id=?")
    .bind(id)
    .first<{ role: string; member_id: number | null }>();
  if (!target) return c.text("账号不存在。", 404);
  if (target.role === "admin") return c.text("管理员账号不能在这里解绑档案。", 400);
  if (target.role !== "member" || !target.member_id) return c.text("该账号当前没有绑定队员档案。", 409);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE user SET role='user',member_id=NULL,auth_version=auth_version+1 WHERE id=? AND role='member' AND member_id=?",
    ).bind(id, target.member_id),
    c.env.DB.prepare("DELETE FROM production_join_request WHERE user_id=? AND status='pending'").bind(id),
  ]);
  return c.redirect("/admin?message=member-unlinked", 303);
});

adminRoutes.post("/admin/users/:id/delete", async (c) => {
  const admin = c.get("user")!;
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const id = Number(c.req.param("id"));
  if (id === admin.id) return c.text("不能删除当前登录的管理员账号。", 400);
  const target = await c.env.DB.prepare("SELECT username,role FROM user WHERE id=?")
    .bind(id)
    .first<{ username: string; role: string }>();
  if (!target) return c.text("账号不存在。", 404);
  if (String(form.get("confirm_username") ?? "").trim() !== target.username)
    return c.text("用户名不一致，未执行删除。", 400);
  if (
    target.role === "admin" &&
    (await c.env.DB.prepare("SELECT COUNT(*) count FROM user WHERE role='admin'").first<{ count: number }>())!.count <=
      1
  )
    return c.text("不能删除最后一个管理员账号。", 400);
  if (
    await c.env.DB.prepare(
      "SELECT id FROM upload_task WHERE user_id=? AND status IN ('uploading','completing') LIMIT 1",
    )
      .bind(id)
      .first()
  )
    return c.text("该账号还有正在上传的文件，请先等待完成或取消上传。", 409);
  await c.env.DB.prepare("DELETE FROM user WHERE id=?").bind(id).run();
  return c.redirect("/admin?message=user-deleted", 303);
});
