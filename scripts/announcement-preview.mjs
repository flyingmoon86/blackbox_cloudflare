// Disposable, loopback-only browser fixture. Uses in-memory synthetic data;
// never reads the local/production database, accounts, files or credentials.
// npm run assets:build && node scripts/announcement-preview.mjs
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { createDatabase, d1, fakeBucket, loadModule, loadWorker, context } from "./backend/harness.mjs";

const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const db = createDatabase();
db.exec("INSERT INTO user(id,username,password_hash,role) VALUES(1,'公告验收管理员','fixture','admin')");
db.prepare("INSERT INTO announcement(id,title,content) VALUES(1,?,?)").run(
  "公告 Markdown · 合成样例",
  "## 欢迎补充资料\n\n欢迎来到 **黑匣子 4.0**。\n\n- [注册账号](/register)\n- [补充资料](/resources/submit)\n- [网站反馈](/feedback)\n\n旧公告的普通文字和换行\n也会正常显示。\n\n| 项目 | 入口 |\n| --- | --- |\n| 队员档案 | [申请认证](/profile/member-application) |",
);
const publicRoot = resolve("public");
const mime = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const env = {
  DB: d1(db),
  FILES: fakeBucket(),
  ENVIRONMENT: "development",
  SESSION_SECRET: "disposable-announcement-fixture",
  ASSETS: {
    fetch: async (request) => {
      const filename = resolve(publicRoot, "." + decodeURIComponent(new URL(request.url).pathname));
      if (!filename.startsWith(publicRoot + sep) || !existsSync(filename) || !statSync(filename).isFile())
        return new Response("Not found", { status: 404 });
      return new Response(readFileSync(filename), {
        headers: { "Content-Type": mime[extname(filename)] || "application/octet-stream" },
      });
    },
  },
};
const session = await createSession(
  { uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 7200 },
  env.SESSION_SECRET,
);
let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(req.headers);
    // Only the synthetic admin workflow gets a fixture session. Public pages
    // stay anonymous, so following a public link exercises real login gates.
    if (url.pathname.startsWith("/admin/announcements/") || url.pathname === "/admin/notifications")
      headers.set("Cookie", `blackbox_csrf=announcement-fixture; blackbox_session=${session}`);
    const ctx = context();
    const response = await worker.fetch(
      new Request(url, {
        method: req.method,
        headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      }),
      env,
      ctx,
    );
    let bytes = Buffer.from(await response.arrayBuffer());
    if (url.searchParams.get("editor-script") === "off" && response.headers.get("content-type")?.includes("text/html"))
      bytes = Buffer.from(
        bytes.toString().replace(/<script src="[^\"]*announcement-editor[^\"]*" defer><\/script>/g, ""),
      );
    const outgoing = Object.fromEntries(response.headers);
    delete outgoing["content-length"];
    delete outgoing["set-cookie"];
    res.writeHead(response.status, outgoing);
    res.end(bytes);
    await ctx.flush();
  } catch (error) {
    res.writeHead(500);
    res.end("Synthetic fixture failed");
    console.error(error.message);
  }
});
await new Promise((done) => server.listen(Number(process.env.ANNOUNCEMENT_PREVIEW_PORT || 0), "127.0.0.1", done));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(`${origin}/admin/announcements/new`);
