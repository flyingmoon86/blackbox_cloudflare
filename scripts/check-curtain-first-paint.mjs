// Direct detail first paint: no navigation curtain, even while media/defer wait.
// Synthetic view fixture only: no database, account, cookies or production URLs.
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "node:http";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    pathToFileURL(
      "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
    ).href
);
const dir = resolve(process.env.EVIDENCE_DIR || "artifacts/native-navigation/first-paint");
mkdirSync(dir, { recursive: true });
await build({
  entryPoints: ["src/views/productions.ts"],
  outfile: ".wrangler/curtain-view.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
});
const { productionDetailPage } = await import(pathToFileURL(resolve(".wrangler/curtain-view.mjs")));
const html = productionDetailPage(
  { id: 991008, title: "幕布首帧验收", year: 2026, cover_id: 1, cover_ratio: "landscape" },
  [],
  [],
  [],
  null,
  [],
  "synthetic",
);
const cover = readFileSync("public/images/elephant-mascot-360-v1.webp");
const publicRoot = resolve("public");
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/productions/991008") return res.writeHead(200, { "Content-Type": "text/html" }).end(html);
  if (pathname === "/site/theme.css") return res.writeHead(200, { "Content-Type": "text/css" }).end("");
  const file = resolve(publicRoot, "." + pathname);
  if (!file.startsWith(publicRoot + "/") && !file.startsWith(publicRoot + "\\")) return res.writeHead(403).end();
  try {
    res.writeHead(200, {
      "Content-Type": pathname.endsWith(".js")
        ? "application/javascript"
        : pathname.endsWith(".css")
          ? "text/css"
          : "application/octet-stream",
    });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const target = "http://127.0.0.1:" + server.address().port + "/productions/991008";
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const results = [];
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 768 },
      hasTouch: width === 390,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.curtainEvents = [];
      window.curtainInsertions = 0;
      const seen = new WeakSet();
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            const candidates = [node, ...node.querySelectorAll(".blackbox-curtain,.work-curtain")];
            for (const candidate of candidates) {
              if (!candidate.matches(".blackbox-curtain,.work-curtain") || seen.has(candidate)) continue;
              seen.add(candidate);
              window.curtainInsertions++;
            }
          }
      }).observe(document, { childList: true, subtree: true });
      window.pageLoaded = false;
      window.addEventListener("load", () => {
        window.pageLoaded = true;
      });
      document.addEventListener(
        "animationstart",
        (event) => {
          if (event.animationName.startsWith("curtain-"))
            window.curtainEvents.push({ name: event.animationName, at: performance.now() });
        },
        true,
      );
    });
    let releaseScript, releaseCover;
    let covers = 0;
    const scriptGate = new Promise((done) => {
      releaseScript = done;
    });
    const coverGate = new Promise((done) => {
      releaseCover = done;
    });
    await page.route(/\/assets\/experience\.[^.]+\.js$/, async (route) => {
      await scriptGate;
      await route.continue();
    });
    await page.route("**/productions/991008/cover?*", async (route) => {
      covers++;
      await coverGate;
      await route.fulfill({ contentType: "image/webp", body: cover });
    });
    try {
      await page.goto(target, { waitUntil: "commit" });
      await page.locator("h1").waitFor({ state: "visible" });
      await page.waitForFunction(() => !document.querySelector(".blackbox-curtain"));
      const beforeMedia = await page.evaluate(() => ({
        bodyVisible: getComputedStyle(document.body).visibility !== "hidden",
        loaded: window.pageLoaded,
        coverComplete: document.querySelector(".work-cover-full").complete,
        nativeSource: document.querySelector(".work-cover-full").getAttribute("src"),
        events: window.curtainEvents,
        curtainInsertions: window.curtainInsertions,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(beforeMedia.bodyVisible, true);
      assert.equal(beforeMedia.loaded, false, "Content is available before deferred script/window.load");
      assert.equal(beforeMedia.coverComplete, false, "Content is usable while native image transfer is pending");
      assert.match(beforeMedia.nativeSource, /\/productions\/991008\/cover/);
      assert.deepEqual(beforeMedia.events, [], "Direct detail must not play a curtain animation");
      assert.equal(beforeMedia.curtainInsertions, 0, "No transient curtain may be inserted");
      assert.equal(beforeMedia.overflow, false);
      assert.equal(covers, 1, "Native cover starts without waiting for experience.js");
      await page.screenshot({ path: dir + "/" + width + "-content-before-media.png" });
      releaseScript();
      releaseCover();
      await page.waitForLoadState("load");
      assert.equal(
        await page.locator(".work-cover-full").evaluate((image) => image.naturalWidth > 0 && !image.hidden),
        true,
      );
      assert.equal(await page.locator(".blackbox-curtain").count(), 0, "Late resources must not restart loading");
      assert.equal(await page.evaluate(() => window.curtainInsertions), 0);
      assert.deepEqual(errors, []);
      results.push({ width, scenario: "direct-detail-slow-cover-and-deferred-script", beforeMedia, covers, errors });
    } finally {
      releaseScript();
      releaseCover();
      await page.close();
    }
  }
  for (const mode of ["script-failed", "boot-failed", "css-failed", "cover-failed", "no-js", "reduced"]) {
    const page = await browser.newPage({
      javaScriptEnabled: mode !== "no-js",
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    });
    await page.route("**/productions/991008/cover?*", (route) =>
      route.fulfill(
        mode === "cover-failed" ? { status: 503, body: "unavailable" } : { contentType: "image/webp", body: cover },
      ),
    );
    if (mode === "script-failed") await page.route(/\/assets\/experience\.[^.]+\.js$/, (route) => route.abort());
    if (mode === "boot-failed") await page.route(/\/assets\/curtain-boot\.[^.]+\.js$/, (route) => route.abort());
    if (mode === "css-failed") await page.route(/\/assets\/curtain\.[^.]+\.css$/, (route) => route.abort());
    await page.goto(target, { waitUntil: "load" });
    await page.waitForFunction(() => !document.querySelector(".blackbox-curtain"));
    assert.equal(await page.locator("h1").isVisible(), true);
    assert.equal(await page.locator(".work-cover-full").evaluate((image) => !image.hidden), true);
    if (mode !== "cover-failed")
      assert.equal(await page.locator(".work-cover-full").evaluate((image) => image.naturalWidth > 0), true);
    assert.equal(await page.locator("[data-curtain-src],.work-curtain,html.curtain-pending").count(), 0);
    results.push({ mode, readable: true, nativeCover: true, curtainRemoved: true });
    await page.close();
  }
  writeFileSync(
    dir + "/metrics.json",
    JSON.stringify(
      { evidence: "Rendered browser automation; synthetic data", browser: await browser.version(), results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
