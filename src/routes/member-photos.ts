import { assetUrl } from "../views/assets";
import { Hono, type Context, type Next } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { csrfFor, csrfValid } from "../http/cookies";
import { readBoundedBody } from "../http/validation";
import { consumeAccountLimit } from "../middleware/request-limits";
import { canMaintain, certified } from "../services/member-records";
import { storeMemberPhoto } from "../services/member-photo-storage";
import { serveResourceFile } from "../services/resource-files";
import { memberPhotosPage, memberPhotoReviewPage, type FeaturedPhoto } from "../views/member-photos";
import { layout } from "../views/layout";
import { escapeHtml } from "../views/html";

export const memberPhotoRoutes = new Hono<AppEnv>();
memberPhotoRoutes.get("/admin/member-photos", async (c) => {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const user = c.get("user");
  if (!user) return c.text("请先登录。", 401);
  if (!certified(user) || user.role !== "admin") return c.text("仅管理员可查看。", 403);
  const page = Math.min(100000, Math.max(1, Number(c.req.query("page")) || 1)) | 0;
  const pending = "status='pending' AND members_consent=1 AND archived=0";
  const [rows, total] = await Promise.all([
    c.env.DB.prepare(
      `SELECT m.id,m.name,COUNT(*) AS count FROM member_featured_photo p JOIN member m ON m.id=p.member_id WHERE ${pending} GROUP BY m.id,m.name ORDER BY MIN(p.updated_at),m.id LIMIT 51 OFFSET ?`,
    )
      .bind((page - 1) * 50)
      .all<{ id: number; name: string; count: number }>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS count FROM member_featured_photo WHERE ${pending}`).first<{ count: number }>(),
  ]);
  return c.html(memberPhotoReviewPage(rows.results.slice(0, 50), total?.count || 0, page, rows.results.length > 50));
});
const management = new Hono<AppEnv>();
const missing = () => new HTTPException(404, { message: "照片不存在或不可访问。" });
const memberId = (c: Context<AppEnv>) => {
  const raw = c.req.param("member") || "";
  if (!/^[1-9]\d{0,9}$/.test(raw)) throw missing();
  return Number(raw);
};
const guard =
  "EXISTS(SELECT 1 FROM user WHERE id=? AND auth_version=? AND status='active' AND must_change_password=0 AND (role='admin' OR (role='member' AND member_id=?)))";
const guardParams = (c: Context<AppEnv>) => [c.get("user")!.id, c.get("user")!.auth_version, memberId(c)];
const base = (c: Context<AppEnv>) =>
  `${c.req.path.startsWith("/admin/") ? "/admin" : "/profile"}/members/${memberId(c)}/photos`;
async function formBody(c: Context<AppEnv>, limit = 16384) {
  const bytes = await readBoundedBody(c.req.raw, limit);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: c.req.raw.headers }).formData();
  } catch {
    throw new HTTPException(400, { message: "表单格式不正确。" });
  }
  if (!csrfValid(c, form.get("csrf"))) throw new HTTPException(400, { message: "请求已失效，请刷新重试。" });
  return form;
}
const caption = (form: FormData) => {
  const value = form.get("caption");
  if (value !== null && typeof value !== "string") throw new HTTPException(400, { message: "说明格式不正确。" });
  const result = (value || "").trim();
  if (result.length > 300) throw new HTTPException(400, { message: "照片说明最多 300 字。" });
  return result;
};
async function authorizePhotos(c: Context<AppEnv>, next: Next) {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  const user = c.get("user");
  if (!user) return c.text("请先登录。", 401);
  if (
    !certified(user) ||
    !canMaintain(user, memberId(c)) ||
    (c.req.path.startsWith("/admin/") && user.role !== "admin")
  )
    throw missing();
  if (!(await c.env.DB.prepare("SELECT id FROM member WHERE id=?").bind(memberId(c)).first())) throw missing();
  await next();
  c.header("Cache-Control", "private, no-store");
}
management.use("/:member/photos", authorizePhotos);
management.use("/:member/photos/*", authorizePhotos);
management.get("/:member/photos", async (c) => {
  const member = await c.env.DB.prepare("SELECT name FROM member WHERE id=?")
    .bind(memberId(c))
    .first<{ name: string }>();
  const photos = await c.env.DB.prepare(
    "SELECT id,caption,status,members_consent,archived,version FROM member_featured_photo WHERE member_id=? ORDER BY archived,CASE status WHEN 'pending' THEN 0 ELSE 1 END,updated_at DESC,id DESC",
  )
    .bind(memberId(c))
    .all<FeaturedPhoto>();
  return c.html(
    memberPhotosPage(
      memberId(c),
      member!.name,
      photos.results,
      await csrfFor(c),
      c.get("user")!.role === "admin",
      c.req.query("saved") === "1",
    ),
  );
});
management.post("/:member/photos", async (c) => {
  const form = await formBody(c, 9 * 1024 * 1024),
    id = String(form.get("upload_id") || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    throw new HTTPException(400, { message: "上传编号不正确。" });
  if (form.get("members_consent") !== "1")
    throw new HTTPException(400, { message: "请选择是否允许在个人档案展示这张照片。" });
  const text = caption(form),
    existing = await c.env.DB.prepare("SELECT member_id FROM member_featured_photo WHERE id=?")
      .bind(id)
      .first<{ member_id: number }>();
  if (existing) {
    if (existing.member_id !== memberId(c)) throw missing();
    return c.redirect(base(c) + "?saved=1", 303);
  }
  const retry = await consumeAccountLimit(c, "member-featured-photo", 20);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("上传次数较多，请稍后重试。", 429);
  }
  await storeMemberPhoto(c.env, c.get("user")!.id, form.get("photo"), (key) =>
    c.env.DB.prepare(
      `INSERT INTO member_featured_photo(id,member_id,object_key,caption,status,members_consent,updated_by) SELECT ?,?,?,?,?,1,? WHERE ${guard} ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id,
      memberId(c),
      key,
      text,
      c.get("user")!.role === "admin" ? "approved" : "pending",
      c.get("user")!.id,
      ...guardParams(c),
    ),
  );
  return c.redirect(base(c) + "?saved=1", 303);
});
management.post("/:member/photos/:photo", async (c) => {
  const form = await formBody(c),
    version = Number(form.get("version")),
    action = String(form.get("action") || ""),
    admin = c.get("user")!.role === "admin";
  if (!Number.isSafeInteger(version) || version < 1) throw new HTTPException(400, { message: "照片版本不正确。" });
  const photo = await c.env.DB.prepare(
    "SELECT id,caption,status,members_consent,archived,version FROM member_featured_photo WHERE id=? AND member_id=?",
  )
    .bind(c.req.param("photo"), memberId(c))
    .first<FeaturedPhoto>();
  if (!photo) throw missing();
  if (["approve", "reject", "restore"].includes(action) && !admin)
    throw new HTTPException(403, { message: "仅管理员可以审核或恢复照片。" });
  if (photo.archived && action !== "restore") throw missing();
  if (action === "approve" && !photo.members_consent)
    throw new HTTPException(409, { message: "尚未同意向认证队员展示，不能审核展示。" });
  const changes: Record<string, string> = {
    approve: "status='approved'",
    reject: "status='rejected'",
    withdraw: "members_consent=0",
    archive: "archived=1,members_consent=0",
    restore: "archived=0,members_consent=0,status='pending'",
    publish: `members_consent=1,status='${admin ? "approved" : "pending"}'`,
    edit: `caption=?,status='${admin ? "approved" : "pending"}'`,
  };
  if (!Object.hasOwn(changes, action)) throw new HTTPException(400, { message: "操作不正确。" });
  const result = await c.env.DB.prepare(
    `UPDATE member_featured_photo SET ${changes[action]},version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND member_id=? AND version=? AND ${guard}`,
  )
    .bind(
      ...(action === "edit" ? [caption(form)] : []),
      c.get("user")!.id,
      photo.id,
      memberId(c),
      version,
      ...guardParams(c),
    )
    .run();
  if (result.meta.changes < 1) throw new HTTPException(409, { message: "照片已变化，请刷新核对后重试。" });
  return c.redirect(base(c) + "?saved=1", 303);
});
management.get("/:member/photos/:photo/history", async (c) => {
  if (c.get("user")!.role !== "admin") throw new HTTPException(403, { message: "仅管理员可查看历史。" });
  const rows = await c.env.DB.prepare(
    "SELECT h.version,h.caption,h.status,h.members_consent,h.archived,h.actor_id,h.created_at FROM member_featured_photo_history h JOIN member_featured_photo p ON p.id=h.photo_id WHERE p.member_id=? AND p.id=? ORDER BY h.version DESC",
  )
    .bind(memberId(c), c.req.param("photo"))
    .all();
  if (!rows.results.length) throw missing();
  return c.html(
    layout(
      "精选照片历史",
      `<section class="member-records card"><link rel="stylesheet" href="${assetUrl("/member-records.css")}"><h1>精选照片历史</h1><pre>${escapeHtml(JSON.stringify(rows.results, null, 2))}</pre><a href="${base(c)}">返回照片管理</a></section>`,
      true,
      true,
    ),
  );
});
memberPhotoRoutes.route("/profile/members", management);
memberPhotoRoutes.route("/admin/members", management);
memberPhotoRoutes.get("/members/:member/photos/:photo/file", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const user = c.get("user");
  if (!certified(user)) throw missing();
  const photo = await c.env.DB.prepare(
    "SELECT object_key,status,members_consent,archived FROM member_featured_photo WHERE id=? AND member_id=?",
  )
    .bind(c.req.param("photo"), memberId(c))
    .first<{ object_key: string; status: string; members_consent: number; archived: number }>();
  const own = canMaintain(user!, memberId(c));
  if (
    !photo ||
    photo.archived ||
    photo.status === "rejected" ||
    (!own && !(photo.status === "approved" && photo.members_consent))
  )
    throw missing();
  const response = await serveResourceFile(c.req.raw, c.env.FILES, { key: photo.object_key });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
