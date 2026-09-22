import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
export async function creditFixture() {
  const db = createDatabase();
  db.exec(
    "INSERT INTO member(id,name,bio) VALUES(1,'张三','保留简介'),(2,'李四',''),(3,'同名',''),(4,'同名',''); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'管理员','hash','admin',NULL),(2,'队员','hash','member',1),(3,'普通账号','hash','user',NULL); INSERT INTO production(id,title,year) VALUES(10,'合成作品',2026),(20,'另一作品',2025); INSERT INTO production_edition(id,production_id,name,year) VALUES(30,10,'复排版',2026);",
  );
  const env = {
    DB: d1(db),
    FILES: fakeBucket(),
    SESSION_SECRET: "credit-test",
    ENVIRONMENT: "development",
    ASSETS: { fetch: async () => new Response("", { status: 404 }) },
  };
  const cookies = {};
  for (const id of [1, 2, 3])
    cookies[id] =
      "blackbox_csrf=credit-csrf; blackbox_session=" +
      (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
  const req = (id, path, options = {}) =>
    worker.fetch(
      new Request("https://blackbox.test" + path, {
        ...options,
        headers: { Cookie: cookies[id] || "", ...options.headers },
      }),
      env,
      context(),
    );
  const post = (id, path, fields = {}) =>
    req(id, path, { method: "POST", body: new URLSearchParams({ csrf: "credit-csrf", ...fields }) });
  const upload = (text, id = 1, fields = {}, name = "test.csv") => {
    const form = new FormData();
    form.set("csrf", "credit-csrf");
    form.set("edition_id", "30");
    form.set("file", new File([text], name));
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return req(id, "/admin/productions/10/credits/import/preview", { method: "POST", body: form });
  };
  return { db, env, worker, cookies, req, post, upload };
}
