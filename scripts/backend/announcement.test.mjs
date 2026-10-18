import assert from "node:assert/strict";
import test from "node:test";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";

const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { announcementLink, announcementExcerpt, renderAnnouncement, ANNOUNCEMENT_MAX_LENGTH } = await loadModule(
  "src/shared/announcement-markdown.ts",
);

async function setup(t) {
  const db = createDatabase();
  t.after(() => db.close());
  db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(1,'公告管理员','fixture','admin'),(2,'普通账号','fixture','user');",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "announcement-test-secret",
    ENVIRONMENT: "production",
    PUBLIC_ORIGIN: "https://blackbox.test",
    ADMIN_ORIGIN: "https://admin.blackbox.test",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2])
    cookies[id] =
      "blackbox_csrf=announcement-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (path, id = 0, options = {}, origin = env.ADMIN_ORIGIN) =>
    worker.fetch(
      new Request(origin + path, {
        ...options,
        headers: { Cookie: cookies[id] || "blackbox_csrf=announcement-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (fields = {}, id = 1, headers = {}) =>
    req("/admin/announcements/new", id, {
      method: "POST",
      headers,
      body: new URLSearchParams({ csrf: "announcement-csrf", title: "合成公告", content: "合成正文", ...fields }),
    });
  const count = () => db.prepare("SELECT COUNT(*) AS n FROM announcement").get().n;
  return { db, env, req, post, count };
}

test("announcement Markdown renders headings, emphasis, lists, tables and links without browser JavaScript", () => {
  const html = renderAnnouncement(
    "# 版本更新\n\n**欢迎回家**\n\n- [注册账号](/register)\n- [补充资料](/resources/submit)\n\n| 功能 | 状态 |\n| :--- | ---: |\n| 公告链接 | 可用 |",
  );
  assert.match(html, /<h2>版本更新<\/h2>/);
  assert.match(html, /<strong>欢迎回家<\/strong>/);
  assert.match(html, /<ul>[\s\S]*<li><a href="\/register">注册账号<\/a><\/li>/);
  assert.match(html, /<a href="\/resources\/submit">补充资料<\/a>/);
  assert.match(html, /<div class="announcement-table"><table>/);
  assert.match(html, /<td align="right">可用<\/td>/);
  assert.doesNotMatch(html, /<h1\b|<script\b|\sstyle=/);
});

test("ordinary legacy text retains single newlines, paragraphs and literal HTML", () => {
  const html = renderAnnouncement("第一行\r\n第二行 & 保留\r\n\r\n第三段 <b>字样</b>");
  assert.match(html, /<p>第一行<br>第二行 &amp; 保留<\/p>/);
  assert.match(html, /<p>第三段 &lt;b&gt;字样&lt;\/b&gt;<\/p>/);
  assert.doesNotMatch(html, /<b>/);
  assert.equal(renderAnnouncement(""), "");
});

test("announcement links reject executable, disguised and protocol-relative URLs", () => {
  const unsafe = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "javascript&#58;alert(1)",
    "&#106;avascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///tmp/document",
    "//evil.test/page",
    "/\\evil.test/page",
    "https://user:password@example.test/",
    "https://example.test/with space",
    "https://example.test/\u0000",
  ];
  for (const href of unsafe) assert.equal(announcementLink(href), null, JSON.stringify(href));
  for (const href of [
    "/register",
    "/resources/submit?作品=黑匣子&year=2026",
    "#notice",
    "https://example.test/path?q=1&next=2",
    "http://example.test/",
    "mailto:hello@example.test",
  ])
    assert.equal(announcementLink(href), href, href);
  for (const href of unsafe.filter((value) => !/[\s<>\u0000]/.test(value)))
    assert.doesNotMatch(renderAnnouncement(`[入口](<${href}>)`), /<a\b/, href);
});

test("Markdown escapes raw HTML, image payloads and link attributes while preserving readable labels", () => {
  const html = renderAnnouncement(
    '<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)>\n\n[<b>入口</b>](/register)\n\n![照片](https://evil.test/pixel.png)\n\n[安全文字](<https://example.test/"onmouseover="x>)\n\n[实体](javascript&#58;alert%281%29)',
  );
  assert.doesNotMatch(html, /<(?:script|img|svg|b)\b|<a[^>]+\sonmouseover\s*=|href="javascript:/i);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<a href="\/register">&lt;b&gt;入口&lt;\/b&gt;<\/a>/);
  assert.match(html, /<p>照片<\/p>/);
  assert.match(html, /href="https:\/\/example\.test\/&quot;onmouseover=&quot;x"/);
  assert.match(html, /<p>实体<\/p>/);
});

test("announcement excerpts remove formatting and destinations, decode readable entities, and cap length", () => {
  assert.equal(announcementExcerpt("## 更新\n\n**欢迎** [注册账号](/register) & 好友"), "更新 欢迎 注册账号 & 好友");
  assert.equal(announcementExcerpt("&#x1f3ad; &lt;文字&gt;"), "🎭 <文字>");
  assert.equal(announcementExcerpt("正文".repeat(120)).length, 160);
  assert.doesNotMatch(announcementExcerpt("[入口](https://example.test/private-path)"), /example|private|\[|\]/);
});

test("announcement writes remain administrator-only and reject missing CSRF and cross-origin requests", async (t) => {
  const s = await setup(t);
  assert.equal((await s.req("/admin/announcements/new")).status, 302);
  assert.equal((await s.req("/admin/announcements/new", 2)).status, 403);
  assert.equal((await s.post({}, 0)).status, 401);
  assert.equal((await s.post({}, 2)).status, 403);
  assert.equal((await s.post({ csrf: "" })).status, 400);
  assert.equal((await s.post({}, 1, { Origin: s.env.PUBLIC_ORIGIN })).status, 403);
  assert.equal((await s.post({}, 1, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal(s.count(), 0);
});

test("announcement server length limits reject overflow without storing records and accept the exact boundary", async (t) => {
  const s = await setup(t);
  assert.equal((await s.post({ content: "字".repeat(ANNOUNCEMENT_MAX_LENGTH + 1) })).status, 400);
  assert.equal((await s.post({ title: "字".repeat(101) })).status, 400);
  assert.equal((await s.post({ title: "  " })).status, 400);
  assert.equal(s.count(), 0);
  assert.equal((await s.post({ content: "字".repeat(ANNOUNCEMENT_MAX_LENGTH) })).status, 303);
  assert.equal(s.db.prepare("SELECT length(content) AS n FROM announcement").get().n, ANNOUNCEMENT_MAX_LENGTH);
});

test("native announcement form submission stores source and publicly renders links with the original CSP", async (t) => {
  const s = await setup(t);
  const content = "## 欢迎\n\n- [注册账号](/register)\n- **补充资料**\n\n<script>不可执行</script>";
  const result = await s.post({ title: "<公告>", content }, 1, { Origin: s.env.ADMIN_ORIGIN });
  assert.equal(result.status, 303);
  const path = result.headers.get("Location");
  assert.match(path, /^\/announcements\/\d+$/);
  assert.equal(s.db.prepare("SELECT content FROM announcement").get().content, content);
  const response = await s.req(path, 0, {}, s.env.PUBLIC_ORIGIN);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<h1>&lt;公告&gt;<\/h1>/);
  assert.match(html, /<h2>欢迎<\/h2>/);
  assert.match(html, /<a href="https:\/\/blackbox\.test\/register">注册账号<\/a>/);
  assert.match(html, /<strong>补充资料<\/strong>/);
  assert.match(html, /&lt;script&gt;不可执行&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>不可执行/);
  assert.match(response.headers.get("Content-Security-Policy"), /script-src 'self';/);
  assert.doesNotMatch(response.headers.get("Content-Security-Policy"), /unsafe-inline|unsafe-eval/);
  const list = await (await s.req("/announcements", 0, {}, s.env.PUBLIC_ORIGIN)).text();
  assert.match(list, /欢迎 注册账号 补充资料/);
  assert.doesNotMatch(list, /\[注册账号\]\(\/register\)/);
});

test("admin announcement preview and reading resolve root links to the configured public site", async (t) => {
  const s = await setup(t);
  const response = await s.req("/admin/announcements/new", 1);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /data-public-origin="https:\/\/blackbox\.test"/);
  assert.match(html, /name="content"[^>]*maxlength="20000"/);
  assert.match(html, /<form method="post">/);
  assert.match(html, /type="button"[^>]*data-preview-toggle/);
  assert.match(html, /<noscript>[\s\S]*仍可填写 Markdown 并发布/);
  assert.match(html, /<script src="[^"<>]*announcement-editor[^"<>]*\.js" defer><\/script>/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const published = await s.post({ content: "[注册](/register) [位置](#notice) [外链](https://example.test/)" });
  const detail = await (await s.req(published.headers.get("Location"), 1)).text();
  assert.match(detail, /href="https:\/\/blackbox\.test\/register">注册/);
  assert.match(detail, /href="#notice">位置/);
  assert.match(detail, /href="https:\/\/example\.test\/">外链/);
  assert.doesNotMatch(detail, /href="https:\/\/admin\.blackbox\.test\/register"/);
});
