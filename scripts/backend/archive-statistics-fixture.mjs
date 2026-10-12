// Disposable, synthetic Workers + D1 environment shared by regression and browser preview.
import { buildSync } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

export const statisticsSecret = "disposable-archive-statistics-fixture";
export const statisticsOrigins = { admin: "http://localhost:8788", publicSite: "http://127.0.0.1:8788" };
export function statisticsCookie(uid, overrides = {}) {
  const body = Buffer.from(
    JSON.stringify({ uid, version: 0, exp: Math.floor(Date.now() / 1000) + 3600, ...overrides }),
  ).toString("base64url");
  return "blackbox_session=" + body + "." + createHmac("sha256", statisticsSecret).update(body).digest("base64url");
}

function migrationStatements(sql) {
  const statements = [];
  let buffer = "";
  for (const line of sql.replace(/--.*$/gm, "").split("\n")) {
    buffer += line + "\n";
    if ((/CREATE TRIGGER/i.test(buffer) ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) && buffer.trim()) {
      statements.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) throw Error("Unparsed migration SQL");
  return statements;
}

export async function createStatisticsFixture({ preview = false, bulk = false } = {}) {
  // The optional bootstrap is compiled only for a loopback preview, never into src/index.ts.
  const entry = preview
    ? {
        stdin: {
          contents: `
    import worker from "./src/index.ts";
    import { createSession } from "./src/auth/session.ts";
    export default { async fetch(request, env, ctx) {
      const url = new URL(request.url);
      if (env.ENVIRONMENT === "development" && url.origin === env.ADMIN_ORIGIN && url.pathname === "/__fixture/admin") {
        const token = await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now()/1000)+3600 }, env.SESSION_SECRET);
        return new Response(null, { status: 303, headers: { Location: "/admin/archive-statistics", "Set-Cookie": "blackbox_session="+token+"; HttpOnly; SameSite=Lax; Path=/", "Cache-Control": "private, no-store" } });
      }
      return worker.fetch(request, env, ctx);
    } };`,
          resolveDir: resolve("."),
          sourcefile: "archive-statistics-preview-entry.ts",
        },
      }
    : { entryPoints: ["src/index.ts"] };
  const bundle = buildSync({
    ...entry,
    bundle: true,
    write: false,
    platform: "browser",
    format: "esm",
    external: ["node:*"],
    logLevel: "silent",
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      ...(preview ? { host: "127.0.0.1", port: 8788 } : {}),
      workers: [
        {
          name: "archive-statistics-fixture",
          modules: true,
          script: bundle.outputFiles[0].text,
          compatibilityDate: "2026-09-08",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            SESSION_SECRET: statisticsSecret,
            ENVIRONMENT: "development",
            ADMIN_ORIGIN: statisticsOrigins.admin,
            PUBLIC_ORIGIN: statisticsOrigins.publicSite,
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
  try {
    const db = await mf.getD1Database("DB");
    for (const name of readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort())
      for (const sql of migrationStatements(readFileSync("migrations/" + name, "utf8"))) await db.prepare(sql).run();
    await seedStatisticsData(db, bulk);
    return {
      mf,
      db,
      request(path, uid = 1, { origin = statisticsOrigins.admin, headers = {}, ...options } = {}) {
        return mf.dispatchFetch(origin + path, {
          ...options,
          headers: { ...(uid === null ? {} : { Cookie: statisticsCookie(uid) }), ...headers },
          redirect: "manual",
        });
      },
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}

export async function seedStatisticsData(db, bulk = false) {
  await db.batch([
    db.prepare(
      "INSERT INTO user(id,username,password_hash,email,role,status,must_change_password) VALUES(1,'合成管理员','synthetic-password-marker','synthetic-admin@example.invalid','admin','active',0),(2,'合成普通账号','synthetic-password-marker','synthetic-user@example.invalid','user','active',0),(3,'合成禁用管理员','synthetic-password-marker',NULL,'admin','disabled',0),(4,'合成临时管理员','synthetic-password-marker',NULL,'admin','active',1),(5,'合成队员账号','synthetic-password-marker',NULL,'member','active',0)",
    ),
    db.prepare("INSERT INTO member(id,name) VALUES(1,'合成队员甲'),(2,'合成队员乙'),(3,'合成队员丙')"),
    db.prepare(
      "INSERT INTO production(id,title,year,is_hidden) VALUES(1,'候场（合成）',2024,0),(2,'回声（合成）',NULL,0),(3,'未公开剧目（合成）',2025,1)",
    ),
    db.prepare(
      "UPDATE production_edition SET name=CASE production_id WHEN 1 THEN '首演' WHEN 2 THEN '待整理' ELSE '预排' END",
    ),
    db.prepare("INSERT INTO production_edition(id,production_id,name,year) VALUES(4,1,'复排',2025)"),
    db.prepare(
      "INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) VALUES(1,1,1,'cast','主角'),(1,1,1,'crew','灯光'),(1,1,2,'cast','配角'),(1,4,1,'cast','主角'),(3,3,3,'crew','导演')",
    ),
  ]);
  const resources = [
    [1, 1, "approved", "首演照片", "photo", null, null],
    [1, 1, "approved", "首演剧本", "script", 1, "2026-09-01 06:00:00"],
    [1, 1, "approved", "首演场记", "other", null, null],
    [1, 4, "approved", "复排照片", "photo", null, null],
    [1, 4, "pending", "复排待审剧本", "script", null, null],
    [1, 4, "rejected", "复排驳回照片", "photo", 1, "2026-09-01 04:00:00"],
    [3, 3, "approved", "隐藏作品照片", "photo", null, null],
    [null, null, "approved", "无作品剧本", "script", null, null],
    [2, 2, "approved", "待整理版本场记", "other", null, null],
  ];
  await db.batch(
    resources.map((args, index) =>
      db
        .prepare(
          "INSERT INTO resource(id,production_id,edition_id,status,title,res_type,reviewed_by,reviewed_at,uploader_id,filename,admin_note,created_at) VALUES(?,?,?,?,?,?,?,?,2,?,'private-review-note-marker','2026-09-01 00:00:00')",
        )
        .bind(index + 1, ...args, `synthetic-private-object-${index + 1}`),
    ),
  );
  if (bulk) await addStatisticsBulkData(db);
}

export async function addStatisticsBulkData(db) {
  const statements = [];
  for (let index = 0; index < 70; index++) {
    const id = index + 100;
    statements.push(db.prepare("INSERT INTO member(id,name) VALUES(?,?)").bind(id, `合成分页队员${index + 1}`));
    statements.push(
      db
        .prepare("INSERT INTO production_edition(id,production_id,name,year) VALUES(?,1,?,2024)")
        .bind(id, `合成分页版本${index + 1}`),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO production_credit(production_id,edition_id,member_id,kind,role_name) VALUES(1,?,?,'cast','演员')",
        )
        .bind(id, id),
    );
    statements.push(
      db
        .prepare(
          "INSERT INTO resource(production_id,edition_id,status,title,res_type,filename) VALUES(1,?,'approved',?,'photo',?)",
        )
        .bind(id, `合成分页照片${index + 1}`, `synthetic-bulk-private-object-${index + 1}`),
    );
  }
  for (let offset = 0; offset < statements.length; offset += 80) await db.batch(statements.slice(offset, offset + 80));
}
