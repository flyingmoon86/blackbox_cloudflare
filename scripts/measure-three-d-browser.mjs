import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import { creditFixture } from "./backend/credit-import-fixture.mjs";
import { context } from "./backend/harness.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright"
);
const modelPath = resolve(
  process.env.THREE_D_MODEL_PATH || "artifacts/archive/releases/2026-11-06-three-d-archive/scene-03.compressed.ply",
);
const coverPath = resolve(
  process.env.THREE_D_COVER_PATH || "artifacts/archive/releases/2026-11-06-three-d-archive/scene-3.jpg",
);
const evidenceDir = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-06-three-d-loading/performance");
mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  scope: "Local Worker with synthetic accounts, in-memory D1, mock R2 and a real compressed PLY",
  checks: [],
};
const fixture = await creditFixture();
const assetRoot = resolve("public");
const mimeTypes = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
fixture.env.ASSETS.fetch = async (request) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const path = resolve(assetRoot, "." + pathname);
  if (!path.startsWith(assetRoot + sep)) return new Response("", { status: 404 });
  try {
    return new Response(readFileSync(path), {
      headers: { "Content-Type": mimeTypes[extname(path)] || "application/octet-stream" },
    });
  } catch {
    return new Response("", { status: 404 });
  }
};

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fixture.worker.fetch(
      new Request(
        "http://127.0.0.1:" +
          server.address().port +
          req.url
            .replace(/([?&])raw=1&?/, "$1")
            .replace(/([?&])transfer=gzip/, req.url.includes("raw=1") ? "$1" : "$&"),
        {
          method: req.method,
          headers: req.headers,
          ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        },
      ),
      fixture.env,
      context(),
    );
    const headers = Object.fromEntries(response.headers);
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) headers["set-cookie"] = setCookies;
    res.writeHead(response.status, headers);
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch (error) {
    console.error(error);
    if (res.headersSent) res.destroy(error);
    else res.writeHead(500).end("Synthetic fixture error");
  }
});
await new Promise((done) => server.listen(Number(process.env.THREE_D_PREVIEW_PORT) || 0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + server.address().port;
const live = process.argv.includes("--production");
const origin = live ? "https://npublackbox.online" : base;
const archiveRoot = "artifacts/archive/releases/2026-11-06-three-d-archive";
if (!live) {
  for (const id of ["03", "05"]) {
    const key = "three-d-archive/" + id + "/model.ply";
    await fixture.env.FILES.put(key, readFileSync(resolve(archiveRoot, `scene-${id}.compressed.ply`)));
    const source = await fixture.env.FILES.head(key);
    await fixture.env.FILES.put(
      key + ".transfer-" + source.etag + ".gz",
      gzipSync(readFileSync(resolve(archiveRoot, `scene-${id}.compressed.ply`)), { level: 9 }),
    );
    await fixture.env.FILES.put(
      "three-d-archive/" + id + "/cover.jpg",
      readFileSync(resolve(archiveRoot, `scene-${Number(id)}.jpg`)),
    );
  }
}
if (process.argv.includes("--serve")) {
  if (live) throw new Error("--serve is local only");
  console.log("Synthetic preview: " + base + "/3d");
  await new Promise(() => {});
}
let browser;
try {
  browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: process.argv.includes("--direct") ? ["--no-proxy-server"] : [],
  });
  evidence.scope = live
    ? "Production read-only guest, desktop GPU and mobile viewport emulation"
    : "Local synthetic D1/R2 with real models; desktop GPU, mobile viewport emulation; CDP network throttling";
  evidence.runs = [];
  for (const id of process.argv.includes("--checks-only") ? [] : ["03", "05"]) {
    for (const transfer of live ? ["gzip"] : ["raw", "gzip"]) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      const responses = [];
      cdp.on("Network.responseReceived", (e) => {
        if (e.response.url.includes("/model"))
          responses.push({
            status: e.response.status,
            fromDiskCache: e.response.fromDiskCache,
            headers: Object.fromEntries(
              Object.entries(e.response.headers).filter(
                ([key]) => !["set-cookie", "cookie", "authorization"].includes(key.toLowerCase()),
              ),
            ),
          });
      });
      await page.goto(origin + "/3d");
      const card = page.locator(`.splat-card:has([data-splat-open*="/scenes/${id}/model"])`);
      await card.waitFor();
      const idle = await page.evaluate(
        () => performance.getEntriesByType("resource").filter((e) => /\/model|three-d-engine/.test(e.name)).length,
      );
      assert.equal(idle, 0);
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 80,
        downloadThroughput: 1000000,
        uploadThroughput: 1000000,
      });
      if (transfer === "raw") await card.locator("button").evaluate((el) => (el.dataset.splatOpen += "?raw=1"));
      for (let attempt = 0; attempt < (transfer === "gzip" ? 2 : 1); attempt++) {
        await card.getByRole("button", { name: /打开三维场景/ }).click();
        await page.locator("[data-splat-loading]").waitFor({ state: "visible" });
        if (!attempt) await page.screenshot({ path: resolve(evidenceDir, `${id}-${transfer}-loading.png`) });
        await page.waitForFunction(
          () => document.querySelector('[data-splat-action="reset"]')?.disabled === false,
          null,
          { timeout: 180000 },
        );
        const result = await page.evaluate(() => {
          const t = performance.getEntriesByName("three-d-load").at(-1).detail;
          const r = performance
            .getEntriesByType("resource")
            .filter((e) => e.name.includes("/model"))
            .at(-1);
          return {
            totalMs: t.readyAt - t.clickedAt,
            engineMs: t.engineReadyAt - t.clickedAt,
            downloadObservedMs: t.downloadedAt - t.startedAt,
            decodeRemainingMs: t.initializedAt - t.downloadedAt,
            framingMs: t.framedAt - t.initializedAt,
            renderPreparationMs: t.readyAt - t.framedAt,
            splats: t.splats,
            cacheHit: t.cacheHit,
            payloadBytes: t.transferredBytes,
            network: r
              ? {
                  duration: r.duration,
                  ttfb: r.responseStart - r.requestStart,
                  bodyMs: r.responseEnd - r.responseStart,
                  transferSize: r.transferSize,
                  encodedBodySize: r.encodedBodySize,
                }
              : null,
          };
        });
        result.id = id;
        result.transfer = transfer;
        result.attempt = attempt;
        result.networkProfile = "8 Mbps / 80 ms simulated";
        if (attempt === 1) {
          assert.equal(result.cacheHit, true);
          assert.equal(result.payloadBytes, 0);
        }
        evidence.runs.push(result);
        console.log(JSON.stringify(result));
        if (!attempt) {
          for (const view of ["reset", "front", "top"]) {
            await page.locator(`[data-splat-action="${view}"]`).click();
            await page.waitForTimeout(600);
            await page.screenshot({ path: resolve(evidenceDir, `${id}-${transfer}-${view}.png`) });
          }
        }
        await page.getByRole("button", { name: /关闭/ }).click();
        await page.locator("canvas").waitFor({ state: "detached" });
      }
      assert.deepEqual(errors, []);
      // Store only public model response metadata, never account headers.
      evidence.checks.push({ id, transfer, responses });
      await ctx.close();
    }
  }
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 760 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const mobileErrors = [];
  page.on("pageerror", (e) => mobileErrors.push(e.message));
  await page.goto(origin + "/3d");
  const cdp = await ctx.newCDPSession(page);
  if (!live) {
    await page.route("**/3d/scenes/03/model*", (route) => route.fulfill({ status: 503, body: "Synthetic failure" }));
    await page.locator('[data-splat-open*="/scenes/03/model"]').click();
    await page.locator("[data-splat-retry]").waitFor({ state: "visible" });
    assert(await page.locator("[data-splat-poster]").isVisible());
    await page.screenshot({ path: resolve(evidenceDir, "mobile-retry.png") });
    await page.unroute("**/3d/scenes/03/model*");
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 100,
      downloadThroughput: 100000,
      uploadThroughput: 100000,
    });
    const cancelled = page.waitForEvent("requestfailed", {
      predicate: (r) => r.url().includes("/model"),
      timeout: 15000,
    });
    await page.locator("[data-splat-retry]").click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /关闭/ }).click();
    await cancelled;
    await page.locator("canvas").waitFor({ state: "detached" });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    evidence.checks.push(
      "503 retains cover and retry; closing during throttled retry aborts transfer and removes renderer",
    );
  }
  await page.locator('[data-splat-open*="/scenes/03/model"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-splat-action="spin"]').disabled, null, {
    timeout: 90000,
  });
  await page.screenshot({ path: resolve(evidenceDir, "mobile-ready.png") });
  const frames = [];
  cdp.on("Page.screencastFrame", (event) => {
    frames.push({ timestamp: event.metadata.timestamp, data: event.data });
    cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 70,
    maxWidth: 390,
    maxHeight: 760,
    everyNthFrame: 1,
  });
  await page.locator('[data-splat-action="spin"]').click();
  await page.waitForTimeout(4000);
  await page.locator('[data-splat-action="spin"]').click();
  await cdp.send("Page.stopScreencast");
  const gaps = frames
    .slice(1)
    .map((f, i) => (f.timestamp - frames[i].timestamp) * 1000)
    .sort((a, b) => a - b);
  evidence.motion = {
    scope: "CDP actual compositor frames in mobile viewport on desktop GPU, not real phone FPS",
    frames: frames.length,
    uniqueFrames: new Set(frames.map((f) => f.data)).size,
    medianGapMs: gaps[Math.floor(gaps.length / 2)],
    p95GapMs: gaps[Math.floor(gaps.length * 0.95)],
  };
  for (const [i, f] of frames.entries())
    if (i % 10 === 0) writeFileSync(resolve(evidenceDir, `motion-${i}.jpg`), Buffer.from(f.data, "base64"));
  console.log(JSON.stringify(evidence.motion));
  if (!live) {
    await page.getByRole("button", { name: /关闭/ }).click();
    const newBytes = readFileSync(resolve(archiveRoot, "scene-03.compressed.ply"));
    await fixture.env.FILES.put("three-d-archive/03/model.ply", newBytes);
    await page.locator('[data-splat-open*="/scenes/03/model"]').click();
    await page.waitForFunction(() => !document.querySelector('[data-splat-action="spin"]').disabled, null, {
      timeout: 90000,
    });
    assert.equal(await page.evaluate(() => performance.getEntriesByName("three-d-load").at(-1).detail.cacheHit), false);
    await page.getByRole("button", { name: /关闭/ }).click();
    fixture.db.exec("UPDATE three_d_scene SET status='archived' WHERE id='03'");
    await page.locator('[data-splat-open*="/scenes/03/model"]').click();
    await page.locator("[data-splat-retry]").waitFor({ state: "visible" });
    assert.equal(await page.locator("canvas").count(), 0);
    evidence.checks.push(
      "Replacing the source invalidates the file cache and gzip derivative; archiving denies cached playback",
    );
  }
  assert.deepEqual(mobileErrors, []);
  await ctx.close();
  evidence.success = true;
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  fixture.db.close();
  writeFileSync(resolve(evidenceDir, "measurement.json"), JSON.stringify(evidence, null, 2));
}
