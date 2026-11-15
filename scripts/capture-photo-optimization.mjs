import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { navigationFixture } from "./navigation-fixture.mjs";
import { staticAssets } from "./browser/worker-server.mjs";
import { launchBrowser, evidenceDirectory, waitForPageReady, waitForImage } from "./browser/runtime.mjs";

const baseline = process.argv[2];
if (!/^[0-9a-f]{7,40}$/.test(baseline || ""))
  throw Error("Usage: node scripts/capture-photo-optimization.mjs BASE_COMMIT");
const output = evidenceDirectory("photo-optimization-report");
const root = resolve(".");
const original = (path) => execFileSync("git", ["show", `${baseline}:${path}`], { encoding: "utf8" });
const temp = mkdtempSync(join(tmpdir(), "blackbox-photo-baseline-"));
const bundle = join(temp, "worker.mjs");
await build({
  entryPoints: [resolve("src/index.ts")],
  outfile: bundle,
  platform: "node",
  format: "esm",
  bundle: true,
  logLevel: "silent",
  plugins: [
    {
      name: "real-git-baseline",
      setup(buildApi) {
        buildApi.onLoad(
          { filter: /src[\\/]((routes|views)[\\/]resources|services[\\/]resource-queries)\.ts$/ },
          (args) => ({
            contents: original(args.path.slice(root.length + 1).replaceAll("\\", "/")),
            loader: "ts",
            resolveDir: dirname(args.path),
          }),
        );
      },
    },
  ],
});
const oldWorker = (await import(pathToFileURL(bundle).href)).default;
rmSync(bundle);
rmdirSync(temp);
const fallbackAssets = staticAssets();
const oldCss = original("public/app.css");
const browser = await launchBrowser({ args: ["--no-proxy-server"] });
const results = {
  baseline,
  scope: "Same synthetic data; before uses actual baseline route/view/CSS; local Worker, no production writes",
  screenshots: [],
  checks: [],
  errors: [],
  passed: false,
};
let edition;
let snapshotDB;
const setup = async ({ db, files }) => {
  snapshotDB = db;
  edition = db.prepare("SELECT edition_id FROM resource WHERE id=1").get().edition_id;
  await files.put("photo-report.webp", readFileSync("public/images/productions-unlit.webp"), {
    httpMetadata: { contentType: "image/webp" },
  });
  db.exec("UPDATE production SET cover_id=NULL WHERE id=1; UPDATE resource SET res_type='other' WHERE id=1");
  const insert =
    db.prepare(`INSERT INTO resource(id,production_id,edition_id,title,filename,original_name,preview_filename,
    uploader_id,status,res_type,created_at) VALUES(?,1,?,'合成剧照','synthetic/'||?,'synthetic.webp','photo-report.webp',2,?,'photo','2026-11-15 12:00:00')`);
  for (let id = 101; id <= 130; id++) insert.run(id, edition, String(id), "approved");
  insert.run(131, edition, "131", "pending");
  for (let id = 101; id <= 131; id++)
    await files.put(`synthetic/${id}`, readFileSync("public/images/productions-unlit.webp"), {
      httpMetadata: { contentType: "image/webp" },
    });
  db.exec(
    "INSERT INTO resource(id,production_id,title,filename,preview_filename,res_type,status) VALUES(132,99,'隐藏作品合成剧照','synthetic/132','photo-report.webp','photo','approved')",
  );
};
try {
  for (const version of ["before", "after"]) {
    const fixture = await navigationFixture(
      0,
      setup,
      version === "before"
        ? {
            worker: oldWorker,
            assets: {
              fetch: (request) =>
                /\/(?:assets\/)?app(?:\.[0-9a-f]+)?\.css$/.test(new URL(request.url).pathname)
                  ? Promise.resolve(new Response(oldCss, { headers: { "Content-Type": "text/css" } }))
                  : fallbackAssets.fetch(request),
            },
          }
        : {},
    );
    try {
      for (const [device, width, height] of [
        ["desktop", 1366, 768],
        ["mobile", 390, 844],
      ]) {
        const context = await browser.newContext({
          viewport: { width, height },
          reducedMotion: "reduce",
          ...(device === "mobile" ? { isMobile: true, hasTouch: true } : {}),
        });
        const page = await context.newPage();
        page.on("pageerror", (error) => results.errors.push(error.message));
        page.on("response", (response) => {
          if (response.status() >= 500) results.errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
        });
        const shot = async (name, selector) => {
          const path = `${version}-${device}-${name}.png`;
          if (selector)
            await page.locator(selector).screenshot({ path: resolve(output, path), animations: "disabled" });
          else await page.screenshot({ path: resolve(output, path), animations: "disabled" });
          results.screenshots.push({
            path,
            version,
            device,
            viewport: { width, height },
            url: new URL(page.url()).pathname + new URL(page.url()).search,
            scope: "Local synthetic browser screenshot",
          });
        };
        const go = async (id, expected = 200) => {
          const response = await page.goto(`${fixture.origin}/resources/${id}?origin=103&page=2`);
          assert.equal(response.status(), expected);
          if (expected === 200) {
            await waitForPageReady(page);
            if (id === 131) {
              const media = await page.request.get(fixture.origin + "/resources/131/media");
              assert.equal(media.status(), 200, "owner can load the synthetic pending photo");
            }
            try {
              await waitForImage(page.locator(".resource-detail-preview img"));
            } catch (error) {
              await shot(`image-failure-${id}`);
              const imagePath = await page.locator(".resource-detail-preview img").getAttribute("src");
              const imageResponse = await page.request.get(fixture.origin + imagePath);
              writeFileSync(
                resolve(output, "image-failure.json"),
                JSON.stringify({
                  id,
                  imagePath,
                  status: imageResponse.status(),
                  type: imageResponse.headers()["content-type"],
                }),
              );
              throw error;
            }
          }
        };
        await go(103);
        assert.equal(await page.locator(".photo-position").count(), version === "before" ? 1 : 0);
        await page.evaluate(() => scrollTo(0, 0));
        await shot("detail");
        await shot("navigation", "[data-photo-navigation]");
        await page.locator("[data-photo-navigation]").scrollIntoViewIfNeeded();
        await shot("navigation-context");
        if (version === "after") {
          await page.locator("[data-photo-next]").click();
          await page.waitForURL(/\/resources\/102\?origin=103&page=2/);
          await waitForPageReady(page);
          await shot("next", "[data-photo-navigation]");
          await page.keyboard.press("ArrowLeft");
          await page.waitForURL(/\/resources\/103\?origin=103&page=2/);
          await waitForPageReady(page);
          await page.locator(".resource-back-links a").click();
          await page.waitForURL(
            new RegExp(`/productions/1\\?edition=${edition}&page=2&photo=103#edition-${edition}-resources`),
          );
          await waitForPageReady(page);
          await page.locator('[data-photo-lightbox][href^="/resources/103?"]').scrollIntoViewIfNeeded();
          await shot("return-gallery");
          await go(130);
          await shot("first", "[data-photo-navigation]");
          assert.equal(await page.locator("[data-photo-previous]").count(), 0);
          await go(101);
          await shot("last", "[data-photo-navigation]");
          assert.equal(await page.locator("[data-photo-next]").count(), 0);
          await go(131, 403);
          await shot("pending-denied");
          await go(132, 404);
          await shot("hidden-denied");
          await page.goto(fixture.origin + "/__fixture/session/member");
          await go(131);
          assert.equal(await page.locator("[data-photo-navigation]").count(), 0);
          await page.evaluate(() => scrollTo(0, 0));
          await shot("owner-pending");
          // Shrink this synthetic album to exercise the one-photo state after all normal checks.
          snapshotDB.exec("UPDATE resource SET status='pending' WHERE id BETWEEN 102 AND 130");
          await go(101);
          await shot("single", "[data-photo-navigation]");
          assert.equal(await page.locator("[data-photo-navigation] a").count(), 0);
          snapshotDB.exec("UPDATE resource SET status='approved' WHERE id BETWEEN 102 AND 130");
          results.checks.push({
            device,
            click: true,
            arrow: true,
            returnPageAndPhoto: true,
            firstLastSingle: true,
            pendingGuest403: true,
            hiddenGuest404: true,
            ownerPendingAllowedWithoutNavigation: true,
          });
        }
        await context.close();
      }
    } finally {
      await fixture.close();
    }
  }
  assert.deepEqual(results.errors, []);
  results.passed = true;
} finally {
  await browser.close();
  writeFileSync(resolve(output, "capture-results.json"), JSON.stringify(results, null, 2) + "\n");
}
console.log(
  JSON.stringify({ passed: results.passed, screenshots: results.screenshots.length, checks: results.checks }),
);
