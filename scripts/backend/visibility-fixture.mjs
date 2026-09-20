import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";

export async function visibilityFixture() {
  const worker = await loadWorker();
  const { createSession } = await loadModule("src/auth/session.ts");
  const db = createDatabase();
  db.exec(`INSERT INTO member(id,name) VALUES(1,'合成测试队员');
    INSERT INTO user(id,username,password_hash,role,member_id) VALUES
      (1,'测试管理员','fixture','admin',NULL),(2,'测试作者','fixture','member',1),(3,'测试用户','fixture','user',NULL);
    INSERT INTO production(id,title,year,is_hidden,theme_color) VALUES
      (1,'公开演出',2025,0,''),(2,'隐藏演出',2026,1,'#aa2233');
    INSERT INTO production_credit(production_id,member_id,kind,role_name) VALUES(2,1,'cast','隐秘角色');
    INSERT INTO resource(id,production_id,title,res_type,status,filename,original_name,preview_filename,uploader_id) VALUES
      (1,1,'公开剧照','photo','approved','public.jpg','public.jpg','public-preview.jpg',2),
      (2,2,'秘密剧照','photo','approved','hidden.jpg','hidden.jpg','hidden-preview.jpg',2),
      (3,2,'秘密剧本','script','approved','hidden.pdf','hidden.pdf','',2),
      (4,2,'秘密待审图','photo','pending','pending.jpg','pending.jpg','pending-preview.jpg',2);
    UPDATE production SET cover_id=id;
    UPDATE site_profile SET featured_production_id=2,hero_photo='2',page_texts='{"productions_background":"2","recruitment_poster":"2","recruitment_poster_mobile":"2","mascot_photo":"2"}' WHERE id=1;`);
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "visibility-synthetic-secret",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
  };
  for (const key of [
    "public.jpg",
    "public-preview.jpg",
    "hidden.jpg",
    "hidden-preview.jpg",
    "hidden.pdf",
    "pending.jpg",
    "pending-preview.jpg",
  ])
    await env.FILES.put(key, new TextEncoder().encode(key));
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=visibility-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (id, path, options = {}) =>
    worker.fetch(
      new Request("http://localhost" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "blackbox_csrf=visibility-csrf", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (id, path, fields = {}) =>
    req(id, path, { method: "POST", body: new URLSearchParams({ csrf: "visibility-csrf", ...fields }) });
  return { db, env, worker, cookies, req, post };
}
