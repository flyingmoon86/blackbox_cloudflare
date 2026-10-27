import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";
import { csrfFor, csrfValid } from "../http/cookies";
import { readBoundedBody } from "../http/validation";
import { consumeAccountLimit } from "../middleware/request-limits";
import {
  certified,
  canMaintain,
  parseDestination,
  recordStatistics,
  csvCell,
  DESTINATIONS,
  type MemberRecord,
} from "../services/member-records";
import { memberRecordsPage, recordsAdminPage, recordHistoryPage } from "../views/member-records";
import { serveResourceFile } from "../services/resource-files";
import { storeMemberPhoto } from "../services/member-photo-storage";

export const memberRecordRoutes = new Hono<AppEnv>();
const detail = new Hono<AppEnv>();
const legacyPhotos = new Hono<AppEnv>();
const missing = () => new HTTPException(404, { message: "资料不存在或不可访问。" });
const conflict = () => new HTTPException(409, { message: "资料已变更或请求已处理，请返回资料页刷新核对后再提交。" });
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const basePath = (c: Context<AppEnv>) =>
  `${c.req.path.startsWith("/admin/") ? "/admin" : ""}/graduation/${c.req.param("member")}`;
const memberId = (c: Context<AppEnv>) => {
  const raw = c.req.param("member") || "";
  if (!/^[1-9]\d{0,9}$/.test(raw)) throw missing();
  return Number(raw);
};
async function formBody(c: Context<AppEnv>, limit = 32 * 1024) {
  if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/i.test(c.req.header("Content-Type") || ""))
    throw new HTTPException(415, { message: "请通过本站表单提交资料。" });
  const bytes = await readBoundedBody(c.req.raw, limit);
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: c.req.raw.headers }).formData();
  } catch {
    throw new HTTPException(400, { message: "表单内容损坏，请返回重试。" });
  }
  if (!csrfValid(c, form.get("csrf"))) throw new HTTPException(400, { message: "请求已失效，请刷新后重试。" });
  return form;
}
const requireMaintain = (c: Context<AppEnv>) => {
  if (!canMaintain(c.get("user")!, memberId(c))) throw missing();
};
const requireAdmin = (c: Context<AppEnv>) => {
  if (c.get("user")?.role !== "admin") throw new HTTPException(403, { message: "仅管理员可用。" });
};
const guard =
  "EXISTS(SELECT 1 FROM user WHERE id=? AND auth_version=? AND status='active' AND must_change_password=0 AND (role='admin' OR (role='member' AND member_id=?)))";
const guardParams = (c: Context<AppEnv>) => [c.get("user")!.id, c.get("user")!.auth_version, memberId(c)];
async function getRecord(c: Context<AppEnv>, id = c.req.param("id")!) {
  const record = await c.env.DB.prepare("SELECT * FROM member_record WHERE id=? AND member_id=?")
    .bind(id, memberId(c))
    .first<MemberRecord>();
  if (!record) throw missing();
  return record;
}
async function writeResult(run: () => Promise<D1Result>) {
  try {
    const result = await run();
    // D1 includes audit-trigger changes; Node SQLite's changes excludes them.
    if (result.meta.changes < 1) throw conflict();
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw conflict();
    throw error;
  }
}
function yearFilter(c: Context<AppEnv>) {
  const raw = c.req.query("year") || "";
  if (raw && !/^(19|20|21)\d{2}$/.test(raw)) throw new HTTPException(400, { message: "请填写有效毕业年份。" });
  return raw ? Number(raw) : undefined;
}

memberRecordRoutes.use("*", async (c, next) => {
  if (!/^\/(?:admin\/)?(?:member-records|graduation)(?:\/|$)/.test(c.req.path)) return next();
  c.header("Cache-Control", "private, no-store");
  c.header("X-Robots-Tag", "noindex, nofollow");
  if (!c.get("user")) return c.text("请先登录。", 401);
  if (!certified(c.get("user"))) return c.text("此资料仅认证队员和管理员可用。", 403);
  if (c.req.path.startsWith("/admin/")) requireAdmin(c);
  await next();
  c.header("Cache-Control", "private, no-store");
});
memberRecordRoutes.on("GET", ["/admin/member-records", "/admin/graduation"], async (c) => {
  const year = yearFilter(c),
    q = (c.req.query("q") || "").trim().slice(0, 50),
    page = Math.max(1, Math.min(100000, Number(c.req.query("page")) || 1));
  const members = await c.env.DB.prepare(
    "SELECT id,name FROM member WHERE name LIKE ? ESCAPE '\\' ORDER BY name,id LIMIT 26 OFFSET ?",
  )
    .bind(
      "%" + q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_") + "%",
      (Math.floor(page) - 1) * 25,
    )
    .all<{ id: number; name: string }>();
  return c.html(
    recordsAdminPage(
      await recordStatistics(c.env.DB, year),
      members.results.slice(0, 25),
      Math.floor(page),
      members.results.length > 25,
      q,
      year ? String(year) : "",
    ),
  );
});
memberRecordRoutes.on("GET", ["/admin/member-records/export", "/admin/graduation/export"], async (c) => {
  const year = yearFilter(c);
  // Only identifiers and statistical fields: no institutions, notes, photos or source.
  const rows = await c.env.DB.prepare(
    `SELECT m.id,m.name,r.graduation_year,r.destination_type,r.updated_at FROM member_record r JOIN member m ON m.id=r.member_id WHERE r.kind='destination' AND r.archived=0 ${year ? "AND r.graduation_year=?" : ""} ORDER BY r.graduation_year DESC,m.id LIMIT 10001`,
  )
    .bind(...(year ? [year] : []))
    .all<{
      id: number;
      name: string;
      graduation_year: number | null;
      destination_type: keyof typeof DESTINATIONS | null;
      updated_at: string;
    }>();
  if (rows.results.length > 10000) return c.text("记录超过单次导出上限，请按毕业年份筛选。", 413);
  const csv = [
    ["队员ID", "姓名", "毕业年份", "去向", "更新时间 UTC"],
    ...rows.results.map((r) => [
      r.id,
      r.name,
      r.graduation_year,
      r.destination_type ? DESTINATIONS[r.destination_type] : "",
      r.updated_at,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return new Response("\ufeff" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="member-destinations.csv"',
      "Cache-Control": "private, no-store",
    },
  });
});
detail.get("/:member", async (c) => {
  const user = c.get("user")!,
    id = memberId(c),
    maintain = canMaintain(user, id);
  const member = await c.env.DB.prepare("SELECT name FROM member WHERE id=?").bind(id).first<{ name: string }>();
  if (!member) throw missing();
  if (!maintain) throw missing();
  const records = await c.env.DB.prepare(
    "SELECT * FROM member_record WHERE member_id=? AND kind='destination' ORDER BY archived,id",
  )
    .bind(id)
    .all<MemberRecord>();
  return c.html(
    memberRecordsPage({
      name: member.name,
      base: basePath(c),
      csrf: maintain ? await csrfFor(c) : "",
      records: records.results,
      admin: user.role === "admin",
      saved: c.req.query("saved") === "1",
    }),
  );
});
detail.post("/:member/save", async (c) => {
  requireMaintain(c);
  const form = await formBody(c),
    id = String(form.get("id") || ""),
    version = Number(form.get("version")),
    kind = String(form.get("kind"));
  if (!uuid(id) || !Number.isSafeInteger(version) || version < 0 || kind !== "destination")
    throw new HTTPException(400, { message: "资料格式不正确。" });
  const previous = version > 0 ? await getRecord(c, id) : undefined;
  const value = parseDestination(form, previous);
  const member = await c.env.DB.prepare("SELECT id FROM member WHERE id=?").bind(memberId(c)).first();
  if (!member) throw missing();
  const values = [
    value.graduation_year,
    value.knowledge,
    value.destination_type,
    value.title,
    value.event_date,
    value.details,
  ];
  if (version === 0) {
    await writeResult(() =>
      c.env.DB.prepare(
        `INSERT INTO member_record(id,member_id,kind,graduation_year,knowledge,destination_type,title,event_date,details,updated_by) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard}`,
      )
        .bind(id, memberId(c), kind, ...values, c.get("user")!.id, ...guardParams(c))
        .run(),
    );
  } else {
    await writeResult(() =>
      c.env.DB.prepare(
        `UPDATE member_record SET graduation_year=?,knowledge=?,destination_type=?,title=?,event_date=?,details=?,audience='admins',consent_by=NULL,verified=0,checked_at=NULL,version=version+1,updated_by=?,action='edit',updated_at=CURRENT_TIMESTAMP WHERE id=? AND member_id=? AND kind=? AND archived=0 AND version=? AND ${guard}`,
      )
        .bind(...values, c.get("user")!.id, id, memberId(c), kind, version, ...guardParams(c))
        .run(),
    );
  }
  return c.redirect(basePath(c) + "?saved=1", 303);
});
detail.post("/:member/:id/action", async (c) => {
  requireMaintain(c);
  const form = await formBody(c),
    record = await getRecord(c),
    action = String(form.get("action")),
    version = Number(form.get("version")),
    user = c.get("user")!;
  if (!["archive", "restore", "consent", "withdraw"].includes(action))
    throw new HTTPException(400, { message: "操作不正确。" });
  // Historical private moments retain archive/recovery through their old URL only.
  if (
    record.kind !== "destination" &&
    (!c.req.path.includes("/member-records/") || !["archive", "restore", "withdraw"].includes(action))
  )
    throw missing();
  if (action === "consent") throw new HTTPException(403, { message: "毕业去向仅本人和管理员可见，不提供共享。" });
  if (action === "restore") requireAdmin(c);
  if (
    record.version !== version ||
    (record.archived && !["restore", "withdraw"].includes(action)) ||
    (action === "restore" && !record.archived)
  )
    throw conflict();
  const changes: Record<string, string> = {
    archive: "archived=1,audience='admins',consent_by=NULL",
    restore: "archived=0,audience='admins',consent_by=NULL,verified=0,checked_at=NULL",
    withdraw: "audience='admins',consent_by=NULL",
  };
  await writeResult(() =>
    c.env.DB.prepare(
      `UPDATE member_record SET ${changes[action]},version=version+1,updated_by=?,action=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND member_id=? AND version=? AND ${guard}`,
    )
      .bind(user.id, action, record.id, record.member_id, version, ...guardParams(c))
      .run(),
  );
  return c.redirect(basePath(c) + "?saved=1", 303);
});
detail.get("/:member/:id/history", async (c) => {
  requireAdmin(c);
  const record = await getRecord(c);
  if (record.kind !== "destination" && !c.req.path.includes("/member-records/")) throw missing();
  const history = await c.env.DB.prepare(
    "SELECT version,snapshot,actor_id,action,created_at FROM member_record_history WHERE record_id=? ORDER BY version DESC",
  )
    .bind(record.id)
    .all<{ version: number; snapshot: string; actor_id: number; action: string; created_at: string }>();
  const photos =
    record.kind === "moment"
      ? await c.env.DB.prepare(
          "SELECT h.* FROM member_record_photo_history h JOIN member_record_photo p ON p.id=h.photo_id WHERE p.record_id=? ORDER BY h.created_at DESC,h.version DESC",
        )
          .bind(record.id)
          .all<{
            photo_id: string;
            version: number;
            status: string;
            archived: number;
            actor_id: number;
            created_at: string;
          }>()
      : undefined;
  return c.html(recordHistoryPage(basePath(c), history.results, photos?.results));
});
legacyPhotos.post("/:member/:id/photos", async (c) => {
  requireMaintain(c);
  const record = await getRecord(c);
  if (record.archived || record.kind !== "moment") throw missing();
  const form = await formBody(c, 9 * 1024 * 1024),
    id = String(form.get("upload_id") || "");
  if (!uuid(id)) throw new HTTPException(400, { message: "上传编号不正确。" });
  const previous = await c.env.DB.prepare("SELECT record_id FROM member_record_photo WHERE id=?")
    .bind(id)
    .first<{ record_id: string }>();
  if (previous) {
    if (previous.record_id !== record.id) throw conflict();
    return c.redirect(basePath(c) + "?saved=1", 303);
  }
  const retry = await consumeAccountLimit(c, "member-record-photo", 20);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("上传次数较多，请稍后重试。", 429);
  }
  await storeMemberPhoto(c.env, c.get("user")!.id, form.get("photo"), (key) =>
    c.env.DB.prepare(
      `INSERT INTO member_record_photo(id,record_id,object_key,status,updated_by) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM member_record WHERE id=? AND member_id=? AND kind='moment' AND archived=0) AND ${guard} ON CONFLICT(id) DO NOTHING`,
    ).bind(
      id,
      record.id,
      key,
      c.get("user")!.role === "admin" ? "approved" : "pending",
      c.get("user")!.id,
      record.id,
      record.member_id,
      ...guardParams(c),
    ),
  );
  return c.redirect(basePath(c) + "?saved=1", 303);
});
legacyPhotos.get("/:member/:id/photos/:photo/file", async (c) => {
  requireMaintain(c);
  const record = await getRecord(c);
  if (record.archived) throw missing();
  const photo = await c.env.DB.prepare(
    "SELECT object_key,status FROM member_record_photo WHERE id=? AND record_id=? AND archived=0",
  )
    .bind(c.req.param("photo"), record.id)
    .first<{ object_key: string; status: string }>();
  if (!photo || photo.status === "rejected") throw missing();
  const response = await serveResourceFile(c.req.raw, c.env.FILES, { key: photo.object_key });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
});
legacyPhotos.post("/:member/:id/photos/:photo/review", async (c) => {
  requireMaintain(c);
  const form = await formBody(c),
    record = await getRecord(c),
    action = String(form.get("action"));
  if (record.archived) throw missing();
  if (action !== "archive") requireAdmin(c);
  const version = Number(form.get("version"));
  if (!Number.isSafeInteger(version) || version < 1)
    throw new HTTPException(400, { message: "资料版本不正确，请刷新重试。" });
  const changes: Record<string, string> = {
    approved: "status='approved'",
    rejected: "status='rejected'",
    archive: "archived=1",
    restore: "archived=0,status='pending'",
  };
  if (!Object.hasOwn(changes, action)) throw new HTTPException(400, { message: "操作不正确。" });
  await writeResult(() =>
    c.env.DB.prepare(
      `UPDATE member_record_photo SET ${changes[action]},version=version+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND record_id=? AND version=? AND ${guard}`,
    )
      .bind(c.get("user")!.id, c.req.param("photo"), record.id, version, ...guardParams(c))
      .run(),
  );
  return c.redirect(basePath(c) + "?saved=1", 303);
});
memberRecordRoutes.route("/member-records", legacyPhotos);
memberRecordRoutes.route("/admin/member-records", legacyPhotos);
memberRecordRoutes.route("/member-records", detail);
memberRecordRoutes.route("/admin/member-records", detail);

memberRecordRoutes.route("/graduation", detail);
memberRecordRoutes.route("/admin/graduation", detail);
