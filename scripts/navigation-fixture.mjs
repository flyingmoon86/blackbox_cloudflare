// Disposable real-Worker preview; synthetic in-memory D1/R2 only.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, d1, fakeBucket, loadWorker, loadModule, context } from "./backend/harness.mjs";

export async function navigationFixture(port = 0) {
  const worker = await loadWorker();
  const { createSession } = await loadModule("src/auth/session.ts");
  const db = createDatabase();
  db.exec(
    "UPDATE site_profile SET troupe_name='黑匣子',introduction='欢迎来到黑匣子。',contact_email='',contact_wechat='',hero_photo='',page_texts='{}',featured_production_id=NULL;",
  );
  const files = fakeBucket();
  const bytes = readFileSync("public/images/elephant-mascot-360-v1.webp");
  for (let id = 1; id <= 8; id++) {
    db.prepare(
      "INSERT INTO production(id,title,year,synopsis,promo,cover_id) VALUES(?,?,2026,'合成演出简介','合成作品',?)",
    ).run(id, `示例作品 ${id}`, id);
    db.prepare(
      "INSERT INTO resource(id,production_id,status,title,res_type,filename,original_name,preview_filename) VALUES(?,?,'approved','合成封面','photo',?,?,?)",
    ).run(id, id, `cover-${id}.webp`, `cover-${id}.webp`, `preview-${id}.webp`);
    db.prepare("INSERT INTO production_edition(production_id,name,year) VALUES(?,'首演',2026)").run(id);
    for (const name of [`cover-${id}.webp`, `preview-${id}.webp`])
      await files.put(name, bytes, { httpMetadata: { contentType: "image/webp" } });
  }
  db.exec(
    "INSERT INTO production(id,title,year,is_hidden) VALUES(99,'PRIVATE_HIDDEN_PRODUCTION',2026,1); INSERT INTO member(id,name,bio,join_year) VALUES(1,'示例队员','舞台上的故事',2024); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'合成管理员','fixture','admin',NULL),(2,'合成队员','fixture','member',1),(3,'合成普通账号','fixture','user',NULL); INSERT INTO announcement(id,title,content) VALUES(1,'欢迎来到黑匣子','仅用于本地验收。');",
  );
  const root = resolve("public");
  const mime = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".webp": "image/webp",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  const env = {
    DB: d1(db),
    FILES: files,
    ENVIRONMENT: "development",
    SESSION_SECRET: "disposable-navigation-only-fixture",
    ASSETS: {
      async fetch(request) {
        const path = new URL(request.url).pathname;
        const file = resolve(root, "." + decodeURIComponent(path));
        if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile())
          return new Response("Not found", { status: 404 });
        return new Response(readFileSync(file), {
          headers: {
            "Content-Type": mime[extname(file)] || "application/octet-stream",
            "Cache-Control": /^\/(assets|fonts)\//.test(path) ? "public, max-age=31536000, immutable" : "no-cache",
          },
        });
      },
    },
  };
  const sessions = {};
  for (const [role, uid] of [
    ["admin", 1],
    ["member", 2],
    ["user", 3],
  ])
    sessions[role] = await createSession(
      { uid, version: 0, exp: Math.floor(Date.now() / 1000) + 7200 },
      env.SESSION_SECRET,
    );
  const requests = [];
  const faults = { delay: 0, path: "", fail: false };
  let origin;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, origin);
      requests.push({ path: url.pathname + url.search, method: incoming.method, at: Date.now() });
      if (url.pathname.startsWith("/__fixture/session/")) {
        const token = sessions[url.pathname.split("/").pop()];
        outgoing.writeHead(302, {
          Location: "/",
          "Set-Cookie": `blackbox_session=${token || ""}; Path=/; HttpOnly; SameSite=Lax`,
        });
        outgoing.end();
        return;
      }
      if (!["GET", "HEAD"].includes(incoming.method)) {
        outgoing.writeHead(405);
        outgoing.end();
        return;
      }
      if (url.pathname === faults.path) {
        if (faults.delay) await new Promise((done) => setTimeout(done, faults.delay));
        if (faults.fail) {
          outgoing.writeHead(503);
          outgoing.end("Synthetic failure");
          return;
        }
      }
      const ctx = context();
      const response = await worker.fetch(
        new Request(url, { method: incoming.method, headers: incoming.headers }),
        env,
        ctx,
      );
      const body = Buffer.from(await response.arrayBuffer());
      const headers = Object.fromEntries(response.headers);
      delete headers["content-length"];
      outgoing.writeHead(response.status, headers);
      outgoing.end(incoming.method === "HEAD" ? undefined : body);
      await ctx.flush();
    } catch (error) {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end("Synthetic fixture error");
      console.error(error.message);
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  origin = `http://127.0.0.1:${server.address().port}`;
  env.PUBLIC_ORIGIN = origin;
  return {
    origin,
    requests,
    faults,
    close: () =>
      new Promise((done) => {
        server.close(done);
        server.closeAllConnections();
      }),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await navigationFixture(Number(process.env.NAVIGATION_PREVIEW_PORT || 8791));
  console.log(fixture.origin);
}
