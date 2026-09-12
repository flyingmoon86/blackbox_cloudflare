import { visitorIdentity, publicLimit } from "../services/visitors";
import { pageNumber, YEARS } from "../views/shared";
import { replaceAvatar, queueCurrentAvatar } from "../services/avatars";
import { drainFileCleanup } from "../services/file-cleanup";
import { serveResourceFile } from "../services/resource-files";
import { consumeAccountLimit } from "../middleware/request-limits";
import { readBoundedBody } from "../http/validation";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import type { AppEnv } from "../types";
import { memberApplicationPage, memberCreatePage, memberDetailPage, memberEditPage, memberListPage } from "../views";

export type MemberRow = {
  productions?: Array<{ id: number; title: string }>;
  id: number;
  name: string;
  bio: string;
  join_year: number | null;
  cohort: string;
  works: string;
  photo: string;
  flower_count: number;
  contributor?: number;
};

export const memberRoutes = new Hono<AppEnv>();
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function validImage(bytes: Uint8Array, type: string): boolean {
  if (bytes.length < 12) return false;
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return bytes.slice(0, 8).every((v, i) => v === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][i]);
  if (type === "image/webp")
    return (
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  if (type === "image/avif") return new TextDecoder().decode(bytes.slice(4, 12)).includes("ftypavif");
  return false;
}

memberRoutes.use("*", async (c, next) => {
  if (
    !c.req.path.startsWith("/members") &&
    !c.req.path.startsWith("/profile/member") &&
    !c.req.path.startsWith("/admin/members")
  )
    return next();
  if (!c.get("user") && !/^\/members(?:\/\d+(?:\/(?:avatar|flowers))?)?$/.test(c.req.path))
    return c.redirect(`/login?next=${encodeURIComponent(c.req.path)}`);
  await next();
});

memberRoutes.get("/members", async (c) => {
  const search = (c.req.query("q") ?? "").trim().slice(0, 80);
  const yearText = c.req.query("year") ?? "";
  const year = /^\d{1,4}$/.test(yearText) ? Number(yearText) : null;
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (search) {
    where.push(
      "(m.name LIKE ? ESCAPE '\\' OR m.cohort LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM production_credit pc JOIN production p ON p.id=pc.production_id WHERE pc.member_id=m.id AND p.title LIKE ? ESCAPE '\\'))",
    );
    const escaped = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    params.push(escaped, escaped, escaped);
  }
  if (year !== null) {
    where.push("m.join_year = ?");
    params.push(year);
  }
  const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total =
    (
      await c.env.DB.prepare(`SELECT COUNT(*) n FROM member m ${condition}`)
        .bind(...params)
        .first<{ n: number }>()
    )?.n || 0;
  const size = 24,
    page = Math.min(pageNumber(c.req.query("page")), Math.max(1, Math.ceil(total / size)));
  const result = await c.env.DB.prepare(
    `SELECT m.id, m.name, m.bio, m.join_year, m.cohort, m.works, m.photo, EXISTS(SELECT 1 FROM site_contributor sc LEFT JOIN user cu ON cu.id=sc.user_id WHERE (sc.member_id=m.id OR cu.member_id=m.id) AND sc.revoked_at IS NULL AND sc.public_consent=1) contributor,
    COUNT(f.id) + (SELECT COUNT(*) FROM visitor_flower vf WHERE vf.member_id=m.id) AS flower_count FROM member m LEFT JOIN flower f ON f.member_id = m.id ${condition}
    GROUP BY m.id ORDER BY m.join_year DESC, m.name COLLATE NOCASE,m.id LIMIT ? OFFSET ?`,
  )
    .bind(...params, size, (page - 1) * size)
    .all<MemberRow>();
  return c.html(
    memberListPage(result.results, YEARS, search, year, c.get("user")?.role === "admin", Boolean(c.get("user")), {
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
  member.productions = (
    await c.env.DB.prepare(
      "SELECT DISTINCT p.id,p.title FROM production p JOIN production_credit pc ON pc.production_id=p.id WHERE pc.member_id=? ORDER BY p.year DESC,p.id DESC",
    )
      .bind(id)
      .all<{ id: number; title: string }>()
  ).results;
  const user = c.get("user")!;
  return c.html(
    memberDetailPage(
      member,
      await csrfFor(c),
      c.req.query("flower") ?? "",
      user?.member_id === id,
      user?.role === "admin",
      Boolean(user),
    ),
  );
});

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

memberRoutes.post("/profile/member/avatar", async (c) => {
  const user = c.get("user")!;
  if (user.role !== "member" || !user.member_id) return c.text("只有已认证队员能上传头像。", 403);
  const form = await new Response(await readBoundedBody(c.req.raw, 16 * 1024 * 1024), {
    headers: c.req.raw.headers,
  }).formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const file = form.get("avatar");
  if (!(file instanceof File) || !IMAGE_TYPES[file.type] || file.size < 1 || file.size > 15 * 1024 * 1024)
    return c.text("请选择 15MB 以内的 JPG、PNG、WebP 或 AVIF 图片。", 400);
  const data = new Uint8Array(await file.arrayBuffer());
  if (!validImage(data, file.type)) return c.text("图片内容与格式不一致。", 400);
  const retry = await consumeAccountLimit(c, "avatar", 20);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("更换头像次数较多，请稍后重试。", 429);
  }
  const previewFile = form.get("avatar_preview");
  let preview: Uint8Array | undefined;
  if (previewFile instanceof File && previewFile.size > 0) {
    if (previewFile.type !== "image/jpeg" || previewFile.size > 512 * 1024)
      return c.text("头像展示图格式或大小不正确。", 400);
    preview = new Uint8Array(await previewFile.arrayBuffer());
    if (!validImage(preview, "image/jpeg")) return c.text("头像展示图内容不正确。", 400);
  }
  await replaceAvatar(c.env, user.id, user.member_id, IMAGE_TYPES[file.type], file.type, data, preview);
  return c.redirect("/profile/member?saved=1", 303);
});

memberRoutes.get("/members/:id/avatar", async (c) => {
  const row = await c.env.DB.prepare("SELECT photo,avatar_preview FROM member WHERE id=?")
    .bind(Number(c.req.param("id")))
    .first<{ photo: string; avatar_preview: string }>();
  if (!row?.photo) return c.text("头像不存在。", 404);
  return serveResourceFile(c.req.raw, c.env.FILES, { key: row.avatar_preview || row.photo });
});

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
        memberEditPage(member, await csrfFor(c), true, c.req.query("saved") === "1" || c.req.query("created") === "1"),
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
    return c.text("请检查队员档案内容。", 400);
  const result = await c.env.DB.prepare(
    "UPDATE member SET name=?,join_year=COALESCE(?,join_year),cohort=CASE WHEN ?='' THEN cohort ELSE ? END,bio=? WHERE id=?",
  )
    .bind(name, year, cohort, cohort, bio, id)
    .run();
  if (result.meta.changes !== 1) return c.text("未找到队员档案。", 404);
  return c.redirect(`/admin/members/${id}/edit?saved=1`, 303);
});

memberRoutes.post("/admin/members/:id/avatar/delete", async (c) => {
  const user = c.get("user")!;
  if (user.role !== "admin") return c.text("没有管理员权限。", 403);
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare("SELECT photo FROM member WHERE id=?").bind(id).first<{ photo: string }>();
  if (!row) return c.text("未找到队员档案。", 404);
  await c.env.DB.batch([
    queueCurrentAvatar(c.env, id),
    c.env.DB.prepare("UPDATE member SET photo='',avatar_preview='' WHERE id=?").bind(id),
  ]);
  await drainFileCleanup(c.env);
  return c.redirect(`/admin/members/${id}/edit?saved=1`, 303);
});

memberRoutes.post("/members/:id/flowers", async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  if (!Number.isInteger(id) || !(await c.env.DB.prepare("SELECT id FROM member WHERE id = ?").bind(id).first()))
    return c.text("未找到队员档案。", 404);
  const sentOn = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const retry = await publicLimit(c, "flower", 40);
  if (retry) {
    c.header("Retry-After", String(retry));
    return c.text("送花次数较多，请稍后再来。", 429);
  }
  const result = user
    ? await c.env.DB.prepare("INSERT OR IGNORE INTO flower(user_id,member_id,sent_on) VALUES(?,?,?)")
        .bind(user.id, id, sentOn)
        .run()
    : await c.env.DB.prepare("INSERT OR IGNORE INTO visitor_flower(visitor_key,member_id,sent_on) VALUES(?,?,?)")
        .bind(await visitorIdentity(c), id, sentOn)
        .run();
  return c.redirect(`/members/${id}?flower=${result.meta.changes === 1 ? "sent" : "already"}`, 303);
});

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
    await c.env.DB.prepare("SELECT id FROM join_request WHERE user_id = ? AND status = 'pending'").bind(user.id).first()
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
