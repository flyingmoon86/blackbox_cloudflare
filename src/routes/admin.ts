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
      `SELECT u.id,u.username,u.email,u.role,u.status,m.name AS member_name FROM user u
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
  const id = Number(c.req.param("id"));
  const request = await c.env.DB.prepare("SELECT * FROM join_request WHERE id=? AND status='pending'")
    .bind(id)
    .first<JoinReview>();
  if (!request) return c.text("申请不存在或已处理。", 404);
  const applicant = await c.env.DB.prepare("SELECT role,status FROM user WHERE id=?")
    .bind(request.user_id)
    .first<{ role: string; status: string }>();
  if (!applicant || applicant.role !== "user" || applicant.status !== "active")
    return c.text("申请账号状态不允许通过。", 409);
  try {
    if (request.apply_type === "bind") {
      if (
        !request.member_id ||
        (await c.env.DB.prepare("SELECT id FROM user WHERE member_id=?").bind(request.member_id).first())
      )
        return c.text("该档案已经绑定其他账号。", 409);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "UPDATE user SET role='member',member_id=?,auth_version=auth_version+1 WHERE id=? AND role='user' AND status='active'",
        ).bind(request.member_id, request.user_id),
        c.env.DB.prepare(
          "UPDATE join_request SET status='approved',admin_note='' WHERE id=? AND status='pending'",
        ).bind(id),
      ]);
    } else {
      const memberId = 1_000_000_000 + crypto.getRandomValues(new Uint32Array(1))[0];
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO member(id,name,bio,join_year,cohort) VALUES(?,?,?,?,?)").bind(
          memberId,
          request.name,
          request.bio,
          request.join_year,
          request.cohort,
        ),
        c.env.DB.prepare(
          "UPDATE user SET role='member',member_id=?,auth_version=auth_version+1 WHERE id=? AND role='user' AND status='active'",
        ).bind(memberId, request.user_id),
        c.env.DB.prepare(
          "UPDATE join_request SET status='approved',admin_note='' WHERE id=? AND status='pending'",
        ).bind(id),
      ]);
    }
  } catch {
    return c.text("审核失败，档案可能已被其他账号绑定，请刷新后重试。", 409);
  }
  return c.redirect("/admin?message=approved", 303);
});

adminRoutes.post("/admin/requests/:id/reject", async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const note = String(form.get("admin_note") ?? "").trim();
  if (note.length < 1 || note.length > 1000) return c.text("请填写 1–1000 字的驳回理由。", 400);
  const result = await c.env.DB.prepare(
    "UPDATE join_request SET status='rejected',admin_note=? WHERE id=? AND status='pending'",
  )
    .bind(note, Number(c.req.param("id")))
    .run();
  if (result.meta.changes !== 1) return c.text("申请不存在或已处理。", 404);
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
