import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import { mkdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createServer } from "node:http";

const publicRoot = resolve("public");
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/site/theme.css") {
    res.writeHead(200, { "Content-Type": "text/css" }).end("");
    return;
  }
  const file = resolve(publicRoot, "." + pathname);
  if (!file.startsWith(publicRoot + "/") && !file.startsWith(publicRoot + "\\")) {
    res.writeHead(403).end();
    return;
  }
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
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const dir = process.env.EVIDENCE_DIR || "docs/evidence/2026-09-20-curtain-first-paint";
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
const target = base + "/productions/991008";
const setup = async (page) => {
  await page.route("**/productions/991008", (route) => route.fulfill({ contentType: "text/html", body: html }));
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 768 } });
    await setup(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const original = HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode = async function () {
        await original.call(this);
        if (this.hasAttribute("data-curtain-src"))
          await new Promise((resolve) => {
            window.releaseDecode = resolve;
          });
      };
    });
    let releaseScript, releaseCover, releaseBackdrop;
    await page.route("**/site/theme.css?*", (route) =>
      route.fulfill({
        contentType: "text/css",
        body: '.design-public::before{background-image:url("/first-frame.webp")!important}',
      }),
    );
    await page.route("**/first-frame.webp", async (route) => {
      await new Promise((resolve) => {
        releaseBackdrop = resolve;
      });
      await route.fulfill({ contentType: "image/webp", body: cover });
    });
    let requests = 0;
    await page.route(/\/assets\/experience\.[^.]+\.js$/, async (route) => {
      await new Promise((resolve) => {
        releaseScript = resolve;
      });
      await route.continue();
    });
    await page.route("**/productions/991008/cover?*", async (route) => {
      requests++;
      await new Promise((resolve) => {
        releaseCover = resolve;
      });
      await route.fulfill({ contentType: "image/webp", body: cover });
    });
    await page.goto(target, { waitUntil: "commit" });
    await page.waitForFunction(() => document.documentElement.classList.contains("curtain-pending"));
    await page.waitForTimeout(400);
    assert.equal(await page.locator("body").evaluate((el) => getComputedStyle(el).visibility), "hidden");
    assert.notEqual(
      await page.evaluate(() => getComputedStyle(document.documentElement, "::before").backgroundImage),
      "none",
    );
    assert.equal(requests, 0);
    await page.screenshot({ path: dir + "/" + width + "-before-script.png" });
    releaseScript();
    await page.locator(".work-curtain").waitFor();
    await page.waitForTimeout(300);
    assert.equal(await page.locator("html").evaluate((el) => el.classList.contains("curtain-pending")), false);
    assert.equal(await page.locator(".is-opening").count(), 0);
    assert.equal(await page.locator(".curtain-meter").getAttribute("aria-valuenow"), null);
    await page.screenshot({ path: dir + "/" + width + "-waiting-cover.png" });
    releaseCover();
    await page.waitForFunction(() => !!window.releaseDecode);
    assert.equal(await page.locator(".is-opening").count(), 0, "must also wait for actual image decode");
    await page.evaluate(() => window.releaseDecode());
    await page.waitForTimeout(350);
    assert.equal(await page.locator(".is-opening").count(), 0, "must wait for CSS backdrop too");
    releaseBackdrop();
    await page.locator(".work-curtain.is-opening").waitFor();
    assert.equal(requests, 1);
    assert.equal(await page.locator(".curtain-progress").isVisible(), false);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: dir + "/" + width + "-opening.png" });
    await page.locator(".work-curtain").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(width + ": script delay, transfer delay, decode gate, opening and one cover request passed");
    await page.close();
  }
  for (const mode of ["escape", "script-failed", "boot-failed", "no-js", "reduced"]) {
    const page = await browser.newPage({
      javaScriptEnabled: mode !== "no-js",
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    });
    await setup(page);
    let releaseScript;
    await page.route("**/productions/991008/cover?*", (route) =>
      route.fulfill({ contentType: "image/webp", body: cover }),
    );
    if (mode === "escape")
      await page.route(/\/assets\/experience\.[^.]+\.js$/, async (route) => {
        await new Promise((resolve) => {
          releaseScript = resolve;
        });
        await route.continue();
      });
    if (mode === "script-failed") await page.route(/\/assets\/experience\.[^.]+\.js$/, (route) => route.abort());
    if (mode === "boot-failed") await page.route(/\/assets\/curtain-boot\.[^.]+\.js$/, (route) => route.abort());
    await page.goto(target, { waitUntil: mode === "escape" ? "commit" : "domcontentloaded" });
    if (mode === "escape") {
      await page.waitForFunction(() => document.documentElement.classList.contains("curtain-pending"));
      await page.keyboard.press("Escape");
      releaseScript();
      await page.waitForLoadState("domcontentloaded");
    }
    if (mode === "script-failed")
      await page.waitForFunction(() => !document.documentElement.classList.contains("curtain-pending"), {
        timeout: 20000,
      });
    await page.locator("h1").waitFor({ state: "visible" });
    assert.equal(await page.locator(".work-curtain").count(), 0);
    await page.waitForFunction(() =>
      [...document.querySelectorAll("img.production-cover")].some((img) => img.naturalWidth > 0 && !img.hidden),
    );
    console.log(mode + ": readable page and native cover fallback passed");
    await page.close();
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
