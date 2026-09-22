import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

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
      const workForm = new URLSearchParams({ csrf: "runtime-csrf", title: "运行时多版本" });
      for (const [name, year] of [
        ["首演", 2024],
        ["复排", 2026],
        ["巡演", 2026],
      ]) {
        workForm.append("edition_name", name);
        workForm.append("edition_year", String(year));
      }
      response = await request(1, "/admin/productions/new", { method: "POST", body: workForm, redirect: "manual" });
      assert.equal(response.status, 303, await response.clone().text());
      const productionId = Number(response.headers.get("location").split("/").pop());
      const editions = (
        await db
          .prepare("SELECT id FROM production_edition WHERE production_id=? ORDER BY year DESC,id DESC")
          .bind(productionId)
          .all()
      ).results;
      assert.equal(editions.length, 3);
      // Exercise the deployed node:zlib/XLSX path and D1 transaction, not only the Node adapter.
      const workbook = unzipSync(readFileSync("templates/production-credit-import-v1.xlsx"));
      for (const name of Object.keys(workbook))
        if (name.endsWith(".xml"))
          workbook[name] = strToU8(strFromU8(workbook[name]).replaceAll("张三", "运行时测试档案"));
      const importForm = new FormData();
      importForm.set("csrf", "runtime-csrf");
      importForm.set("edition_id", String(editions[0].id));
      importForm.set("file", new File([zipSync(workbook)], "runtime.xlsx"));
      const multipart = new Request("https://blackbox.test", { method: "POST", body: importForm });
      const imported = await request(1, `/admin/productions/${productionId}/credits/import/preview`, {
        method: "POST",
        headers: { "Content-Type": multipart.headers.get("Content-Type") },
        body: await multipart.arrayBuffer(),
        redirect: "manual",
      });
      assert.equal(imported.status, 303, await imported.clone().text());
      const importPath = imported.headers.get("location");
      response = await request(1, importPath + "?q=" + encodeURIComponent("测".repeat(80)));
      assert.equal(response.status, 200, await response.clone().text());
      const confirmations = await Promise.all(
        [1, 2].map(() =>
          request(1, importPath + "/confirm", {
            method: "POST",
            body: new URLSearchParams({ csrf: "runtime-csrf", revision: "0", confirm: "yes" }),
            redirect: "manual",
          }),
        ),
      );
      assert.ok(confirmations.some((r) => r.status === 303));
      for (const response of confirmations)
        assert.ok([303, 409].includes(response.status), await response.clone().text());
      assert.equal(
        await db.prepare("SELECT COUNT(*) n FROM production_credit WHERE import_batch_id IS NOT NULL").first("n"),
        1,
      );
      const rolledBack = await request(1, importPath + "/rollback", {
        method: "POST",
        body: new URLSearchParams({ csrf: "runtime-csrf", revision: "1", confirm: "yes" }),
        redirect: "manual",
      });
      assert.equal(rolledBack.status, 303, await rolledBack.clone().text());
      assert.equal(
        await db.prepare("SELECT COUNT(*) n FROM production_credit WHERE import_batch_id IS NOT NULL").first("n"),
        0,
      );
      assert.equal(await db.prepare("SELECT year FROM production WHERE id=?").bind(productionId).first("year"), 2026);
      const bytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 0, 0, 255, 217]);
      response = await request(1, "/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "运行时照片",
          productionId,
          editionId: editions[0].id,
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
      assert.equal(
        await db.prepare("SELECT edition_id FROM resource WHERE id=?").bind(resource.resourceId).first("edition_id"),
        editions[0].id,
      );
      const detail = await (await request(1, "/productions/" + productionId)).text();
      assert.match(detail, /运行时照片/);
      assert.doesNotMatch(detail, />undefined</);
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
