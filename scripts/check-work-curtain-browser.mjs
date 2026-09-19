import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:8788";
const dir = "docs/evidence/2026-09-19-curtain-folds";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 768 },
      hasTouch: width === 390,
    });
    const errors = [];
    await page.addInitScript(() => {
      window.bellTones = 0;
      window.coverTransfers = [];
      const xhrOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (...args) {
        if (String(args[1]).includes("/cover?"))
          this.addEventListener("progress", (e) =>
            window.coverTransfers.push({ loaded: e.loaded, total: e.total, known: e.lengthComputable }),
          );
        return xhrOpen.apply(this, args);
      };
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        window.bellTones++;
        return original.apply(this, args);
      };
    });
    page.on("pageerror", (e) => errors.push(e.message));
    let release;
    let coverRequests = 0;
    await page.route("**/productions/*/cover?*", async (route) => {
      coverRequests++;
      await new Promise((resolve) => {
        release = resolve;
      });
      await route.continue();
    });
    await page.goto(base + "/productions/991008", { waitUntil: "domcontentloaded" });
    await page.locator(".work-curtain:not(.is-opening)").waitFor();
    assert.equal(await page.locator("main > .section-tabs").count(), 0);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "开启铃声");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "直接查看");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "开启铃声");
    await page.waitForTimeout(450);
    assert.equal(await page.locator(".curtain-meter").getAttribute("aria-valuenow"), null);
    assert.equal(await page.locator(".curtain-cloth > g").count(), 2);
    await page.screenshot({ path: `${dir}/${width}-loading.png` });
    const enable = page.getByRole("button", { name: "开启铃声" });
    if (await enable.count()) await enable.click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 200,
      downloadThroughput: 128 * 1024,
      uploadThroughput: 128 * 1024,
    });
    release();
    await page.waitForFunction(
      () => {
        const n = Number(document.querySelector(".curtain-meter")?.getAttribute("aria-valuenow"));
        return n > 0 && n < 100;
      },
      { timeout: 30000 },
    );
    const measuredProgress = await page.locator(".curtain-meter").getAttribute("aria-valuenow");
    const measured = await page.evaluate(() => {
      const event = window.coverTransfers.at(-1);
      return {
        expected: Math.floor((event.loaded / event.total) * 100),
        displayed: Number(document.querySelector(".curtain-meter").getAttribute("aria-valuenow")),
      };
    });
    assert.equal(measured.displayed, measured.expected);
    assert.equal(await page.locator(".is-opening").count(), 0);
    await page.screenshot({ path: `${dir}/${width}-transfer.png` });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.locator(".work-curtain.is-opening").waitFor();
    assert.equal(await page.locator(".curtain-progress").isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "main-content");
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${dir}/${width}-opening.png` });
    await page.waitForTimeout(900);
    const foldSizes = await page
      .locator(".curtain-cloth > g")
      .first()
      .evaluate((g) => {
        const paths = g.querySelectorAll("path");
        const topWidth = (path) => {
          const coordinates = path
            .getAttribute("d")
            .match(/-?\d+(?:\.\d+)?/g)
            .map(Number);
          return coordinates[14] - coordinates[0];
        };
        return { outer: topWidth(paths[0]), inner: topWidth(paths[paths.length - 2]) };
      });
    assert.ok(
      foldSizes.inner < foldSizes.outer * 0.65,
      "The leading folds must gather rather than slide as a rigid sheet",
    );
    await page.screenshot({ path: `${dir}/${width}-gathering.png` });
    await page.waitForTimeout(1100);
    await page.screenshot({ path: `${dir}/${width}-stacked.png` });
    await page.locator(".work-curtain").waitFor({ state: "detached" });
    assert.equal(coverRequests, 1, "Display must reuse the measured download");
    assert.equal(await page.locator(".production-hero noscript").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok(
      await page.evaluate(() => window.bellTones >= 4),
      "Cover and font completion each schedule a two-tone bell",
    );
    await page.screenshot({ path: `${dir}/${width}-ready.png` });
    await page.unroute("**/productions/*/cover?*");
    // Stalled/failed resources remain honest; the reader can skip.
    let unblock;
    await page.route("**/productions/*/cover?*", async (route) => {
      await new Promise((resolve) => {
        unblock = resolve;
      });
      await route.abort();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/加载较慢，可直接查看/).waitFor({ timeout: 10000 });
    assert.equal(await page.locator(".is-opening").count(), 0);
    unblock();
    await page.waitForLoadState("load");
    await page.getByText("封面加载失败，可刷新重试或直接查看").waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".work-curtain").waitFor();
    if (width === 390) await page.getByRole("button", { name: "直接查看" }).tap();
    else await page.keyboard.press("Escape");
    assert.equal(await page.locator(".work-curtain").count(), 0);
    unblock();
    await page.waitForLoadState("load");
    await page.unroute("**/productions/*/cover?*");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".work-curtain").count(), 0);
    assert.ok(await page.locator("img[data-curtain-src]").evaluate((img) => img.naturalWidth > 0));
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        measuredProgress,
        ready: true,
        timeout: true,
        skip: true,
        reducedMotion: true,
        overflow: false,
        errors,
      }),
    );
    await page.close();
  }
  const plainContext = await browser.newContext({ javaScriptEnabled: false });
  const plain = await plainContext.newPage();
  await plain.goto(base + "/productions/991008");
  assert.equal(await plain.locator(".work-curtain").count(), 0);
  assert.ok(await plain.locator(".production-hero h1").isVisible());
  assert.ok(await plain.locator("noscript img").evaluate((img) => img.complete && img.naturalWidth > 0));
  await plainContext.close();
  console.log("noJS: passed");
  // Real chunked HTTP transfer without Content-Length. Do not invent a percentage.
  const proxy = createServer(async (req, res) => {
    try {
      const upstream = await fetch(base + req.url);
      const bytes = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      });
      if (req.url.includes("/cover?")) {
        for (let offset = 0; offset < bytes.length && !res.destroyed; offset += 8192) {
          res.write(bytes.subarray(offset, offset + 8192));
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        res.end();
      } else res.end(bytes);
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  try {
    const unknown = await browser.newPage();
    await unknown.goto("http://127.0.0.1:" + proxy.address().port + "/productions/991008", {
      waitUntil: "domcontentloaded",
    });
    await unknown.getByText(/^已接收 /).waitFor();
    assert.equal(await unknown.locator(".curtain-meter").getAttribute("aria-valuenow"), null);
    assert.equal(await unknown.locator(".is-opening").count(), 0);
    await unknown.screenshot({ path: dir + "/unknown-length.png" });
    await unknown.locator(".work-curtain").waitFor({ state: "detached" });
    assert.ok(await unknown.locator("img[data-curtain-src]").evaluate((img) => img.naturalWidth > 0));
    await unknown.close();
    console.log("unknownContentLength: passed (real chunked HTTP)");
  } finally {
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
} finally {
  await browser.close();
}
