// Local, disposable Workers/D1/R2 preview. No production bindings or persisted data.
import { buildSync } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadModule } from "./harness.mjs";
const { hashPassword } = await loadModule("src/auth/password.ts");
const bundle = buildSync({
  entryPoints: ["src/index.ts"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  external: ["node:*"],
  logLevel: "silent",
});
const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: 8789,
    workers: [
      {
        name: "workbench-preview",
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2026-09-08",
        compatibilityFlags: ["nodejs_compat"],
        bindings: {
          SESSION_SECRET: "local-disposable-workbench-fixture",
          ENVIRONMENT: "development",
          ADMIN_ORIGIN: "http://localhost:8789",
          PUBLIC_ORIGIN: "http://127.0.0.1:8789",
          R2_BUCKET_NAME: "local-preview-only",
        },
        d1Databases: ["DB"],
        r2Buckets: ["FILES"],
        assets: {
          directory: resolve("public"),
          binding: "ASSETS",
          run_worker_first: false,
          routerConfig: { has_user_worker: true },
        },
      },
    ],
  }),
);
const db = await mf.getD1Database("DB");
for (const name of readdirSync("migrations")
  .filter((n) => n.endsWith(".sql"))
  .sort()) {
  let buffer = "";
  for (const line of readFileSync("migrations/" + name, "utf8")
    .replace(/--.*$/gm, "")
    .split("\n")) {
    buffer += line + "\n";
    if ((/CREATE TRIGGER/i.test(buffer) ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) && buffer.trim()) {
      await db.prepare(buffer.trim()).run();
      buffer = "";
    }
  }
  if (buffer.trim()) throw Error("Unparsed SQL: " + name);
}
await db.batch([
  db.prepare(
    "INSERT INTO member(id,name,cohort,bio) VALUES(10,'林夏','2023','舞台灯光与幕后记录'),(11,'周予','2024','表演与剧本整理')",
  ),
  db
    .prepare(
      "INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'demo-admin',?,'admin',NULL),(2,'林夏同学',?,'user',NULL),(3,'陈晨',?,'user',NULL),(4,'周予',?,'member',11)",
    )
    .bind(...Array(4).fill(hashPassword("Workbench-demo-2026"))),
  db.prepare(
    "INSERT INTO join_request(id,user_id,apply_type,member_id,name,identity_note,cohort,bio) VALUES(1,2,'bind',10,'','2023 级，曾参与秋季公演灯光组。','2023',''),(2,3,'new',NULL,'陈晨','2025 年加入话剧队，参加过迎新排练。','2025','喜欢表演，也希望参与舞台设计。')",
  ),
  db.prepare("INSERT INTO production(id,title,year) VALUES(10,'在灯光亮起之前',2026)"),
  db.prepare("INSERT INTO production_edition(id,production_id,name,year) VALUES(10,10,'春季公演',2026)"),
  db.prepare(
    "INSERT INTO production_join_request(user_id,member_id,production_id,edition_id,kind,role_name) VALUES(4,11,10,10,'cast','旁白')",
  ),
  db.prepare(
    "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename) VALUES(10,10,2,'pending','春季公演排练记录','photo','preview/photo.jpg')",
  ),
  db.prepare(
    "INSERT INTO suggestion(user_id,category,content) VALUES(2,'production','希望补充去年迎新演出的作品档案'),(3,'website','历史建议：增加作品年份筛选提示')",
  ),
  db.prepare(
    "INSERT INTO website_feedback(request_key,identity_key,user_id,display_name,public_consent,content) VALUES('preview-1','preview-person',2,'林夏',1,'希望补充演出场次信息。')",
  ),
]);
console.log("Local disposable preview ready: http://localhost:8789/admin");
console.log("Fixture login: demo-admin / Workbench-demo-2026");
await mf.ready;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
