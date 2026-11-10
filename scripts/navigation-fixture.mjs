import { serveWorker, staticAssets } from "./browser/worker-server.mjs";
// Disposable real-Worker preview; synthetic in-memory D1/R2 only.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, d1, fakeBucket, loadWorker, loadModule } from "./backend/harness.mjs";

export async function navigationFixture(port = 0, setup, { allowWrites = false } = {}) {
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
  if (setup) await setup({ db, files });
  const env = {
    DB: d1(db),
    FILES: files,
    ENVIRONMENT: "development",
    SESSION_SECRET: "disposable-navigation-only-fixture",
    ASSETS: staticAssets(),
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
  const server = await serveWorker({
    worker,
    env,
    port,
    allowWrites,
    beforeRequest: async (url, incoming) => {
      requests.push({ path: url.pathname + url.search, method: incoming.method, at: Date.now() });
      if (url.pathname.startsWith("/__fixture/session/")) {
        const token = sessions[url.pathname.split("/").pop()];
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/",
            "Set-Cookie": `blackbox_session=${token || ""}; Path=/; HttpOnly; SameSite=Lax`,
          },
        });
      }
      if (url.pathname === faults.path) {
        if (faults.delay) await new Promise((done) => setTimeout(done, faults.delay));
        if (faults.fail) return new Response("Synthetic failure", { status: 503 });
      }
    },
  });
  env.PUBLIC_ORIGIN = server.origin;
  return { ...server, requests, faults };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await navigationFixture(Number(process.env.NAVIGATION_PREVIEW_PORT || 8791));
  console.log(fixture.origin);
}
