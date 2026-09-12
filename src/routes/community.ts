import { Hono } from "hono";
import type { AppEnv } from "../types";
import { csrfFor, csrfValid } from "../http/cookies";
import { visitorIdentity, publicLimit } from "../services/visitors";
import { escapeHtml as e, layout } from "../views";
export const communityRoutes = new Hono<AppEnv>();
communityRoutes.get("/feedback", async (c) => {
  const user = c.get("user"),
    csrf = await csrfFor(c);
  const receipt = c.req.query("sent"),
    identity = await visitorIdentity(c);
  const saved = receipt
    ? await c.env.DB.prepare(
        "SELECT f.public_consent,c.revoked_at FROM website_feedback f JOIN site_contributor c ON c.identity_key=f.identity_key WHERE f.request_key=? AND f.identity_key=?",
      )
        .bind(receipt, identity)
        .first<{ public_consent: number; revoked_at: string | null }>()
    : null;
  const thanks = saved
    ? '<dialog data-contribution-thanks><form method="dialog"><h2>感谢您的建议</h2><p>' +
      (saved.revoked_at
        ? "建议已经送达管理员。"
        : saved.public_consent
          ? "您已成为“网站贡献者”，可以在鸣谢中找到您。"
          : "已记录您的贡献，您的名字不会公开显示。") +
      '</p><a href="/thanks">查看鸣谢</a> <button>知道了</button></form></dialog>'
    : "";
  const nickname = user
    ? "<p>公开账号：" + e(user.username) + "</p>"
    : '<label>公开昵称<input name="display_name" maxlength="40" required autocomplete="nickname"></label>';
  return c.html(
    layout(
      "网站建议",
      thanks +
        '<section class="card auth"><p class="eyebrow">MAKE IT BETTER</p><h1>让黑匣子更好一点</h1><p>提交成功后会记录您的贡献。邮箱和建议正文不会出现在鸣谢中。</p><form method="post"><input type="hidden" name="csrf" value="' +
        e(csrf) +
        '"><input type="hidden" name="request_key" value="' +
        crypto.randomUUID() +
        '">' +
        nickname +
        '<label>建议<textarea name="content" rows="7" maxlength="3000" required></textarea></label><label class="check"><input name="public_consent" type="checkbox" value="1" checked> 在鸣谢中显示我的名字</label><button>送出建议 ↗</button></form></section>',
      Boolean(user),
      user?.role === "admin",
    ),
  );
});
communityRoutes.post("/feedback", async (c) => {
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效，请刷新。", 400);
  const user = c.get("user"),
    name = user?.username || String(f.get("display_name") || "").trim();
  const content = String(f.get("content") || "").trim(),
    nonce = String(f.get("request_key") || "");
  if (!name || name.length > 50 || !content || content.length > 3000 || !/^[0-9a-f-]{36}$/.test(nonce))
    return c.text("请检查昵称和建议内容。", 400);
  const identity = await visitorIdentity(c),
    key = identity + ":" + nonce;
  const previous = await c.env.DB.prepare("SELECT id FROM website_feedback WHERE request_key=?").bind(key).first();
  if (!previous) {
    const retry = await publicLimit(c, "feedback", 6);
    if (retry) {
      c.header("Retry-After", String(retry));
      return c.text("建议提交次数较多，请稍后重试。", 429);
    }
    await c.env.DB.prepare(
      "INSERT INTO website_feedback(request_key,identity_key,user_id,display_name,public_consent,content) VALUES(?,?,?,?,?,?) ON CONFLICT(request_key) DO NOTHING",
    )
      .bind(key, identity, user?.id ?? null, name, f.get("public_consent") === "1" ? 1 : 0, content)
      .run();
  }
  return c.redirect("/feedback?sent=" + encodeURIComponent(key), 303);
});
communityRoutes.get("/thanks", async (c) => {
  const user = c.get("user");
  const rows = await c.env.DB.prepare(
    "SELECT c.id,c.display_name,COALESCE(m.name,'') member_name,m.id member_id,u.username FROM site_contributor c LEFT JOIN user u ON u.id=c.user_id LEFT JOIN member m ON m.id=COALESCE(c.member_id,u.member_id) WHERE c.revoked_at IS NULL AND c.public_consent=1 ORDER BY c.created_at DESC,c.id DESC",
  ).all<{ id: number; display_name: string; member_name: string; member_id: number | null; username: string | null }>();
  const cards = rows.results
    .map(
      (r) =>
        '<article class="thanks-person"><span class="eyebrow">网站贡献者</span><h2>' +
        (r.member_id
          ? '<a href="/members/' + r.member_id + '">' + e(r.member_name) + "</a>"
          : e(r.username || r.display_name)) +
        "</h2>" +
        (r.member_id ? "<small>" + e(r.username || r.display_name) + "</small>" : "") +
        "</article>",
    )
    .join("");
  return c.html(
    layout(
      "鸣谢",
      '<section class="page-heading"><p class="eyebrow">WITH THANKS</p><h1>每一份心意，都留在这里。</h1><p>感谢一起完善黑匣子的朋友。</p><a href="/feedback">我也有个建议 ↗</a></section><section class="thanks-grid" data-paginate="12">' +
        (cards || "<p>等待第一份心意。</p>") +
        "</section>",
      Boolean(user),
      user?.role === "admin",
    ),
  );
});
communityRoutes.use("/admin/community", async (c, next) => {
  if (!c.get("user")) return c.redirect("/login?next=/admin/community");
  if (c.get("user")?.role !== "admin") return c.text("没有管理员权限。", 403);
  await next();
});
communityRoutes.get("/admin/community", async (c) => {
  const csrf = e(await csrfFor(c));
  const feedback = await c.env.DB.prepare(
    "SELECT id,display_name,content,status,created_at FROM website_feedback ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC",
  ).all<{ id: number; display_name: string; content: string; status: string; created_at: string }>();
  const contributors = await c.env.DB.prepare(
    "SELECT id,display_name,revoked_at,public_consent FROM site_contributor ORDER BY id DESC",
  ).all<{ id: number; display_name: string; revoked_at: string | null; public_consent: number }>();
  const users = await c.env.DB.prepare(
    "SELECT u.id,u.username,m.name member_name FROM user u LEFT JOIN member m ON m.id=u.member_id WHERE u.status='active' ORDER BY u.username",
  ).all<{
    id: number;
    username: string;
    member_name: string | null;
  }>();
  const members = await c.env.DB.prepare(
    "SELECT m.id,m.name FROM member m WHERE NOT EXISTS(SELECT 1 FROM user u WHERE u.member_id=m.id) ORDER BY m.name",
  ).all<{
    id: number;
    name: string;
  }>();
  const hidden = '<input type="hidden" name="csrf" value="' + csrf + '">';
  const notes = feedback.results
    .map(
      (r) =>
        '<article class="card"><p>' +
        e(r.display_name) +
        " · " +
        e(r.created_at) +
        '</p><p class="preline">' +
        e(r.content) +
        '</p><form method="post">' +
        hidden +
        '<input type="hidden" name="action" value="resolve"><input type="hidden" name="id" value="' +
        r.id +
        '"><button>' +
        (r.status === "open" ? "标记已处理" : "已处理") +
        "</button></form></article>",
    )
    .join("");
  const people = contributors.results
    .map(
      (r) =>
        '<article class="card"><p>' +
        e(r.display_name) +
        " · " +
        (r.revoked_at ? "已撤销" : r.public_consent ? "公开显示" : "不公开") +
        '</p><form method="post">' +
        hidden +
        '<input type="hidden" name="action" value="' +
        (r.revoked_at ? "restore" : "revoke") +
        '"><input type="hidden" name="id" value="' +
        r.id +
        '"><button>' +
        (r.revoked_at ? "恢复资格" : "撤销资格") +
        "</button></form></article>",
    )
    .join("");
  const choices =
    users.results
      .map(
        (u) =>
          '<option value="user:' +
          u.id +
          '">' +
          (u.member_name ? e(u.member_name) + "（账号：" + e(u.username) + "）" : "账号 · " + e(u.username)) +
          "</option>",
      )
      .join("") +
    members.results.map((m) => '<option value="member:' + m.id + '">档案 · ' + e(m.name) + "</option>").join("");
  return c.html(
    layout(
      "贡献者与网站建议",
      '<h1>贡献者与网站建议</h1><form method="post" class="card">' +
        hidden +
        '<input type="hidden" name="action" value="grant"><label>授予贡献者<select name="target" required>' +
        choices +
        '</select></label><button>授予网站贡献者</button></form><h2>新建议</h2><section data-paginate="4">' +
        (notes || "<p>暂无建议。</p>") +
        '</section><h2>贡献者名单</h2><section data-paginate="8">' +
        people +
        "</section>",
      true,
      true,
    ),
  );
});
communityRoutes.post("/admin/community", async (c) => {
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效。", 400);
  const action = String(f.get("action")),
    id = Number(f.get("id"));
  if (action === "resolve")
    await c.env.DB.prepare("UPDATE website_feedback SET status='resolved' WHERE id=?").bind(id).run();
  else if (action === "revoke" || action === "restore") {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE site_contributor SET revoked_at=" +
          (action === "revoke" ? "CURRENT_TIMESTAMP" : "NULL") +
          " WHERE id=?",
      ).bind(id),
      c.env.DB.prepare(
        "INSERT INTO contribution_event(contributor_id,source,source_key,actor_id) SELECT id,'admin',?,? FROM site_contributor WHERE id=?",
      ).bind(action + ":" + crypto.randomUUID(), c.get("user")!.id, id),
    ]);
  } else if (action === "grant") {
    const target = String(f.get("target")),
      match = /^(user|member):(\d+)$/.exec(target);
    if (!match) return c.text("请选择有效账号或档案。", 400);
    const isUser = match[1] === "user",
      targetId = Number(match[2]);
    const row = isUser
      ? await c.env.DB.prepare("SELECT username name,id user_id,member_id FROM user WHERE id=? AND status='active'")
          .bind(targetId)
          .first<{ name: string; user_id: number; member_id: number | null }>()
      : await c.env.DB.prepare(
          "SELECT m.name,u.id user_id,m.id member_id FROM member m LEFT JOIN user u ON u.member_id=m.id WHERE m.id=?",
        )
          .bind(targetId)
          .first<{ name: string; user_id: number | null; member_id: number }>();
    if (!row) return c.text("账号或档案不存在。", 404);
    const key = row.user_id ? "user:" + row.user_id : "member:" + row.member_id;
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO site_contributor(identity_key,user_id,member_id,display_name) VALUES(?,?,?,?) ON CONFLICT(identity_key) DO UPDATE SET revoked_at=NULL",
      ).bind(key, row.user_id, row.member_id, row.name),
      c.env.DB.prepare(
        "INSERT INTO contribution_event(contributor_id,source,source_key,actor_id) SELECT id,'admin',?,? FROM site_contributor WHERE identity_key=?",
      ).bind("grant:" + crypto.randomUUID(), c.get("user")!.id, key),
    ]);
  } else return c.text("无效操作。", 400);
  return c.redirect("/admin/community", 303);
});
