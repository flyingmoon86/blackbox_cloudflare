import { thanksPage, type Contributor } from "../views/thanks";
import { Hono } from "hono";
import { turnstileWidget, verifyTurnstile } from "../services/turnstile";
import type { AppEnv } from "../types";
import { csrfFor, csrfValid } from "../http/cookies";
import { visitorIdentity, publicLimit } from "../services/visitors";
import { getSiteProfile } from "../services/site-profile";
import { escapeHtml as e, layout } from "../views";
import { adminPage, adminPageUrl, filterChoice, likeTerm, safeListReturn, searchTerm } from "../http/pagination";
import { adminPagination, filterSelect, listReturnInput } from "../views/admin-pagination";
export const communityRoutes = new Hono<AppEnv>();
communityRoutes.get("/feedback", async (c) => {
  const user = c.get("user"),
    csrf = await csrfFor(c);
  const receipt = c.req.query("sent"),
    identity = await visitorIdentity(c);
  const saved = receipt
    ? await c.env.DB.prepare("SELECT id FROM website_feedback WHERE request_key=? AND identity_key=?")
        .bind(receipt, identity)
        .first<{ id: number }>()
    : null;
  const thanks = saved
    ? '<dialog data-contribution-thanks><form method="dialog"><h2>感谢您的建议</h2><p>建议已经送达管理员。鸣谢名单由管理员另行确认，提交建议不会自动公开您的名字。</p><a href="/thanks">查看鸣谢</a> <button>知道了</button></form></dialog>'
    : "";
  const nickname = user
    ? "<p>提交账号：" + e(user.username) + "</p>"
    : '<label>称呼<input name="display_name" maxlength="40" required autocomplete="nickname"></label>';
  return c.html(
    layout(
      "网站建议",
      thanks +
        '<section class="card auth"><p class="eyebrow">MAKE IT BETTER</p><h1>让黑匣子更好一点</h1><p>建议仅送达管理员，正文不会公开。鸣谢由管理员另行确认，并尊重您留下的公开意愿。</p><form method="post"><input type="hidden" name="csrf" value="' +
        e(csrf) +
        '"><input type="hidden" name="request_key" value="' +
        crypto.randomUUID() +
        '">' +
        nickname +
        turnstileWidget("feedback") +
        '<label>建议<textarea name="content" rows="7" maxlength="3000" required></textarea></label><label class="check"><input name="public_consent" type="checkbox" value="1"> 若管理员确认鸣谢，同意显示我的名字</label><button>送出建议 ↗</button></form></section>',
      Boolean(user),
      user?.role === "admin",
    ),
  );
});
communityRoutes.post("/feedback", async (c) => {
  const f = await c.req.formData();
  if (!csrfValid(c, f.get("csrf"))) return c.text("请求已失效，请刷新。", 400);
  await verifyTurnstile(c, f, "feedback");
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
  const profile = await getSiteProfile(c);
  let special = "";
  try {
    const text = JSON.parse(profile?.page_texts || "{}").special_thanks;
    if (typeof text === "string") special = text.trim();
  } catch {}
  const rows = await c.env.DB.prepare(
    "SELECT c.id,c.display_name,COALESCE(m.name,'') member_name,m.id member_id,u.username FROM site_contributor c LEFT JOIN user u ON u.id=c.user_id LEFT JOIN member m ON m.id=COALESCE(c.member_id,u.member_id) WHERE c.revoked_at IS NULL AND c.public_consent=1 ORDER BY c.created_at DESC,c.id DESC",
  ).all<Contributor>();
  return c.html(thanksPage(special, profile?.troupe_name || "黑匣子话剧队", rows.results, user));
});
communityRoutes.use("/admin/community", async (c, next) => {
  if (!c.get("user")) return c.redirect("/login?next=/admin/community");
  if (c.get("user")?.role !== "admin") return c.text("没有管理员权限。", 403);
  await next();
});
communityRoutes.get("/admin/community", async (c) => {
  const csrf = e(await csrfFor(c));
  const params = {
    q: searchTerm(c.req.query("q")),
    status: filterChoice(c.req.query("status"), ["open", "resolved"]),
    visibility: filterChoice(c.req.query("visibility"), ["public", "private", "revoked"]),
    feedback_page: c.req.query("feedback_page") || "1",
    contributors_page: c.req.query("contributors_page") || "1",
  };
  const feedbackWhere: string[] = [],
    feedbackValues: string[] = [];
  const contributorWhere: string[] = [],
    contributorValues: string[] = [];
  if (params.q) {
    feedbackWhere.push("(display_name LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')");
    feedbackValues.push(likeTerm(params.q), likeTerm(params.q));
    contributorWhere.push("display_name LIKE ? ESCAPE '\\'");
    contributorValues.push(likeTerm(params.q));
  }
  if (params.status) {
    feedbackWhere.push("status=?");
    feedbackValues.push(params.status);
  }
  if (params.visibility === "revoked") contributorWhere.push("revoked_at IS NOT NULL");
  if (params.visibility === "public") contributorWhere.push("revoked_at IS NULL AND public_consent=1");
  if (params.visibility === "private") contributorWhere.push("revoked_at IS NULL AND public_consent=0");
  const feedbackFrom = " FROM website_feedback" + (feedbackWhere.length ? " WHERE " + feedbackWhere.join(" AND ") : "");
  const contributorFrom =
    " FROM site_contributor" + (contributorWhere.length ? " WHERE " + contributorWhere.join(" AND ") : "");
  const [feedbackTotal, contributorTotal] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) n" + feedbackFrom)
      .bind(...feedbackValues)
      .first<number>("n"),
    c.env.DB.prepare("SELECT COUNT(*) n" + contributorFrom)
      .bind(...contributorValues)
      .first<number>("n"),
  ]);
  const feedbackPage = adminPage(
    feedbackTotal || 0,
    params.feedback_page,
    "/admin/community",
    params,
    12,
    "feedback_page",
  );
  const contributorPage = adminPage(
    contributorTotal || 0,
    params.contributors_page,
    "/admin/community",
    params,
    24,
    "contributors_page",
  );
  params.feedback_page = String(feedbackPage.page);
  params.contributors_page = String(contributorPage.page);
  const feedback = await c.env.DB.prepare(
    "SELECT id,display_name,content,status,created_at" +
      feedbackFrom +
      " ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,id DESC LIMIT ? OFFSET ?",
  )
    .bind(...feedbackValues, feedbackPage.size, (feedbackPage.page - 1) * feedbackPage.size)
    .all<{ id: number; display_name: string; content: string; status: string; created_at: string }>();
  const contributors = await c.env.DB.prepare(
    "SELECT id,display_name,revoked_at,public_consent" + contributorFrom + " ORDER BY id DESC LIMIT ? OFFSET ?",
  )
    .bind(...contributorValues, contributorPage.size, (contributorPage.page - 1) * contributorPage.size)
    .all<{ id: number; display_name: string; revoked_at: string | null; public_consent: number }>();
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
  const hidden = '<input type="hidden" name="csrf" value="' + csrf + '">' + listReturnInput(adminPageUrl(feedbackPage));
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
      "<h1>贡献者与网站建议</h1>" +
        `<form method="get" class="filters" role="search"><label>称呼或建议内容<input type="search" name="q" maxlength="100" value="${e(params.q)}"></label><label>建议状态${filterSelect("status", params.status, { "": "全部", open: "待处理", resolved: "已处理" })}</label><label>鸣谢状态${filterSelect("visibility", params.visibility, { "": "全部", public: "公开显示", private: "不公开", revoked: "已撤销" })}</label><button>查找</button><a href="/admin/community">清除</a></form><form method="post" class="card">` +
        hidden +
        '<input type="hidden" name="action" value="grant"><label>授予贡献者<select name="target" required>' +
        choices +
        '</select></label><label class="check"><input type="checkbox" name="public_consent" value="1"> 已取得本人同意公开姓名（已有公开意愿保持不变）</label><button>授予网站贡献者</button></form><h2>网站建议</h2><section data-server-paged>' +
        (notes || "<p>暂无建议。</p>") +
        "</section>" +
        adminPagination(feedbackPage) +
        "<h2>贡献者名单</h2><section data-server-paged>" +
        people +
        "</section>" +
        adminPagination(contributorPage),
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
    const consent = await c.env.DB.prepare(
      "SELECT public_consent FROM website_feedback WHERE identity_key=? ORDER BY id DESC LIMIT 1",
    )
      .bind(key)
      .first<{ public_consent: number }>();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO site_contributor(identity_key,user_id,member_id,display_name,public_consent) VALUES(?,?,?,?,?) ON CONFLICT(identity_key) DO UPDATE SET revoked_at=NULL",
      ).bind(
        key,
        row.user_id,
        row.member_id,
        row.name,
        consent?.public_consent ?? (f.get("public_consent") === "1" ? 1 : 0),
      ),
      c.env.DB.prepare(
        "INSERT INTO contribution_event(contributor_id,source,source_key,actor_id) SELECT id,'admin',?,? FROM site_contributor WHERE identity_key=?",
      ).bind("grant:" + crypto.randomUUID(), c.get("user")!.id, key),
    ]);
  } else return c.text("无效操作。", 400);
  return c.redirect(safeListReturn(f.get("return_to"), "/admin/community"), 303);
});
