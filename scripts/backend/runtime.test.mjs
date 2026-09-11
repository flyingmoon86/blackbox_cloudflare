import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";

function statements(sql) {
  const result = [];
  let buffer = "";
  for (const line of sql.replace(/--.*$/gm, "").split("\n")) {
    buffer += line + "\n";
    const trigger = /CREATE TRIGGER/i.test(buffer);
    if ((trigger ? /^\s*END;\s*$/.test(line) : /;\s*$/.test(line)) && buffer.trim()) {
      result.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) throw Error("Unparsed migration SQL");
  return result;
}
test(
  "real Workers runtime: asset bypass, incremental D1 schema, atomic reviews, streamed R2 upload and Range",
  { timeout: 120000 },
  async () => {
    const bundle = buildSync({
      entryPoints: ["src/index.ts"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "esm",
      external: ["node:*"],
      logLevel: "silent",
    });
    const secret = "runtime-fixture-secret";
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "backend-test",
            modules: true,
            script: bundle.outputFiles[0].text,
            compatibilityDate: "2026-09-08",
            compatibilityFlags: ["nodejs_compat"],
            bindings: { SESSION_SECRET: secret, ENVIRONMENT: "development" },
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
      // No D1 tables exist: a request reaching account middleware would fail for this valid cookie.
      const cookie = (id) => {
        const body = Buffer.from(
          JSON.stringify({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }),
        ).toString("base64url");
        return (
          "blackbox_csrf=runtime-csrf; blackbox_session=" +
          body +
          "." +
          createHmac("sha256", secret).update(body).digest("base64url")
        );
      };
      let response = await mf.dispatchFetch("https://blackbox.test/app.css", { headers: { Cookie: cookie(1) } });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /text\/css/);
      assert.equal(response.headers.get("x-request-id"), null, "static asset must bypass user Worker");
      const db = await mf.getD1Database("DB");
      for (const name of readdirSync("migrations")
        .filter((n) => n.endsWith(".sql"))
        .sort()) {
        for (const sql of statements(readFileSync("migrations/" + name, "utf8"))) await db.prepare(sql).run();
      }
      await db.batch([
        db.prepare(
          "INSERT INTO user(id,username,password_hash,role) VALUES(1,'runtime-admin','fixture','admin'),(2,'runtime-applicant','fixture','user')",
        ),
        db.prepare("INSERT INTO join_request(id,user_id,apply_type,name) VALUES(10,2,'new','运行时测试档案')"),
      ]);
      const request = (id, path, options = {}) =>
        mf.dispatchFetch("https://blackbox.test" + path, {
          ...options,
          headers: { Cookie: cookie(id), "x-csrf-token": "runtime-csrf", ...options.headers },
        });
      response = await request(1, "/admin/requests/10/approve", {
        method: "POST",
        body: new URLSearchParams({ csrf: "runtime-csrf" }),
        redirect: "manual",
      });
      assert.equal(response.status, 303, await response.text());
      assert.equal((await db.prepare("SELECT COUNT(*) n FROM member").first()).n, 1);
      assert.equal(
        (
          await request(1, "/admin/requests/10/approve", {
            method: "POST",
            body: new URLSearchParams({ csrf: "runtime-csrf" }),
            redirect: "manual",
          })
        ).status,
        409,
      );
      const bytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 255, 217]);
      response = await request(1, "/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "运行时照片",
          resType: "photo",
          originalName: "runtime.jpg",
          contentType: "image/jpeg",
          sizeBytes: bytes.length,
        }),
      });
      assert.equal(response.status, 201, await response.clone().text());
      const task = await response.json();
      response = await request(1, "/api/uploads/" + task.id + "/parts/1", { method: "PUT", body: bytes });
      assert.equal(response.status, 200, await response.text());
      response = await request(1, "/api/uploads/" + task.id + "/complete", { method: "POST" });
      assert.equal(response.status, 200, await response.clone().text());
      const resource = await response.json();
      assert.equal(resource.status, "approved");
      response = await request(1, "/resources/" + resource.resourceId + "/media", { headers: { range: "bytes=0-3" } });
      assert.equal(response.status, 206);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(0, 4));
      assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
      const download = await request(1, "/resources/" + resource.resourceId + "/download", { method: "HEAD" });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get("content-length"), String(bytes.length));
    } finally {
      await mf.dispose();
    }
  },
);
