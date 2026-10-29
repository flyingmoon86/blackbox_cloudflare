// Disposable, loopback-only browser fixture. Uses in-memory synthetic data;
// never reads the local/production database, accounts, files or credentials.
// npm run assets:build && node scripts/handbook-preview.mjs
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { createDatabase, d1, fakeBucket, loadModule, loadWorker, context } from "./backend/harness.mjs";

const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const db = createDatabase();
db.exec("INSERT INTO user(id,username,password_hash,role) VALUES(1,'手册验收管理员','fixture','admin')");
db.exec(
  "INSERT INTO member(id,name,cohort,join_year) VALUES(1,'示例队员','2024',2024),(2,'待认证示例队员','2025',2025); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(2,'示例队员账号','fixture','member',1),(3,'示例普通账号','fixture','user',NULL); INSERT INTO production(id,title,year) VALUES(1,'示例演出',2025); UPDATE storage_budget SET initialized=1",
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
const sessions = { admin: session };
for (const [role, uid] of [
  ["member", 2],
  ["user", 3],
])
  sessions[role] = await createSession(
    { uid, version: 0, exp: Math.floor(Date.now() / 1000) + 7200 },
    env.SESSION_SECRET,
  );
let origin;
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET") {
      res.writeHead(405);
      res.end();
      return;
    }
    const url = new URL(req.url, origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(req.headers);
    // Only the synthetic admin workflow gets a fixture session. Public pages
    // stay anonymous, so following a public link exercises real login gates.
    if (url.searchParams.get("role") === "admin" || url.pathname.startsWith("/admin/"))
      headers.set("Cookie", `blackbox_csrf=announcement-fixture; blackbox_session=${session}`);
    if (sessions[url.searchParams.get("role")])
      headers.set("Cookie", `blackbox_session=${sessions[url.searchParams.get("role")]}`);
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
await new Promise((done) => server.listen(Number(process.env.HANDBOOK_PREVIEW_PORT || 0), "127.0.0.1", done));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(`${origin}/help`);
