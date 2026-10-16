// First-entry visual/escape checks against the current public files only.
// Synthetic HTML and anonymous content: no Worker, D1, R2 or deployed endpoint.
// Usage: node scripts/check-curtain-visual.mjs
// Optional: EVIDENCE_DIR, PLAYWRIGHT_MODULE, BROWSER_CHANNEL.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const modulePath =
  process.env.PLAYWRIGHT_MODULE ||
  "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
const { chromium } = await import(modulePath.startsWith("file:") ? modulePath : pathToFileURL(modulePath).href);
const output = resolve(process.env.EVIDENCE_DIR || ".wrangler/evidence/curtain-visual-v2");
const publicRoot = resolve("public");
const texturePath = "/images/curtain-velvet-v1.webp";
mkdirSync(output, { recursive: true });
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>黑匣子首次幕布 · 合成验收</title>
<link rel="stylesheet" href="/curtain.css">
<script src="/curtain-boot.js" data-curtain-page data-site-opening="synthetic-curtain-visual-v2" data-curtain-texture="${texturePath}"></script>
<style>html,body{margin:0;min-height:100%;background:#0d1014;color:#eee8dc;font:16px/1.7 Arial,sans-serif}main{box-sizing:border-box;min-height:100vh;padding:15vh max(24px,8vw);background:radial-gradient(ellipse at 75% 20%,#364047,transparent 65%),#0d1014}p{max-width:38em}h1{font-size:clamp(28px,5vw,64px);font-weight:400}a{color:#ddbb8a;display:inline-block;padding:12px 0}small{color:#bcb9b3}</style></head>
<body><main><small>仅用于本地验收的合成首页</small><h1>黑匣子 · 幕后是舞台</h1><p>这里检验首次加载、揭幕、素材失败和减少动画。此合成页面不代表网站真实内容。</p><a href="/productions">进入作品</a></main></body></html>`;
const server = createServer((request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  response.setHeader("Cache-Control", "no-store");
  if (pathname === "/") return response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
  if (pathname === "/synthetic-preloader-failure.js") return response.writeHead(503).end("synthetic failure");
  if (pathname === "/favicon.ico") return response.writeHead(204).end();
  const file = resolve(publicRoot, "." + decodeURIComponent(pathname));
  if (!file.startsWith(publicRoot + sep)) return response.writeHead(403).end();
  try {
    const bytes = readFileSync(file);
    const contentType = { ".css": "text/css", ".js": "text/javascript", ".webp": "image/webp" }[extname(file)];
    response.writeHead(200, { "Content-Type": contentType || "application/octet-stream" }).end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || "msedge", headless: true });
const results = [];

async function measureStart(page, action = "finish") {
  return page.evaluate((actionName) => {
    const overlay = document.querySelector("#site-opening-curtain");
    const readWings = () =>
      [...overlay.querySelectorAll(".curtain-wing")].map((wing) => {
        const rect = wing.getBoundingClientRect();
        return { x: rect.x, width: rect.width, transform: getComputedStyle(wing).transform };
      });
    const baseline = readWings();
    const started = performance.now();
    const animationStarts = [];
    const frames = [];
    const event = (entry) => {
      if (overlay.contains(entry.target))
        animationStarts.push({ name: entry.animationName, elapsedMs: performance.now() - started });
    };
    document.addEventListener("animationstart", event, true);
    window.syntheticCurtainTiming = new Promise((resolveResult, reject) => {
      let finished = false;
      const timeout = setTimeout(() => {
        observer.disconnect();
        document.removeEventListener("animationstart", event, true);
        reject(Error("Curtain remained mounted for over 4 seconds after finish/failure"));
      }, 4000);
      const complete = () => {
        if (finished || overlay.isConnected) return;
        finished = true;
        clearTimeout(timeout);
        observer.disconnect();
        document.removeEventListener("animationstart", event, true);
        resolveResult({
          measurement: "Unpaused browser animation; performance.now clock; no animation seeking",
          elapsedMs: performance.now() - started,
          baseline,
          animationStarts,
          frames,
          firstMovementMs:
            frames.find((frame) =>
              frame.wings.some(
                (wing, index) =>
                  Math.abs(wing.x - baseline[index].x) > 0.5 || Math.abs(wing.width - baseline[index].width) > 0.5,
              ),
            )?.elapsedMs ?? null,
        });
      };
      const observer = new MutationObserver(complete);
      observer.observe(document, { subtree: true, childList: true });
      const frame = () => {
        if (finished) return;
        if (!overlay.isConnected) return complete();
        frames.push({ elapsedMs: performance.now() - started, wings: readWings() });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      if (actionName === "preloader-failed") {
        const script = document.createElement("script");
        script.src = "/synthetic-preloader-failure.js";
        document.body.append(script);
      } else window.blackboxSiteOpening.finish({ status: "ready" });
      complete();
    });
    return true;
  }, action);
}

async function state(page) {
  return page.evaluate(() => ({
    curtainCount: document.querySelectorAll(".blackbox-curtain").length,
    active: window.blackboxCurtain?.active,
    opening: window.blackboxSiteOpening?.status,
    modalCount: document.querySelectorAll("dialog:modal").length,
    overflow: document.documentElement.scrollWidth > innerWidth,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    headingVisible: getComputedStyle(document.querySelector("h1")).visibility !== "hidden",
  }));
}

try {
  for (const width of [1366, 390]) {
    for (const scenario of [
      "normal",
      "keyframe-sample",
      "texture-failed",
      "texture-slow",
      "preloader-failed",
      "reduced",
      "reduced-during-reveal",
    ]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 768 },
        isMobile: width === 390,
        hasTouch: width === 390,
        reducedMotion: scenario === "reduced" ? "reduce" : "no-preference",
      });
      const page = await context.newPage();
      const errors = [],
        consoleErrors = [],
        requestsFailed = [],
        responsesFailed = [],
        textures = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("requestfailed", (request) =>
        requestsFailed.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          responsesFailed.push({ path: new URL(response.url()).pathname, status: response.status() });
      });
      let holdTimer;
      if (scenario === "texture-failed" || scenario === "texture-slow")
        await page.route("**" + texturePath, async (route) => {
          const entry = { started: Date.now(), finished: null, scenario };
          textures.push(entry);
          if (scenario === "texture-failed") {
            await route.abort("failed");
            entry.finished = Date.now();
          } else {
            await new Promise((done) => {
              holdTimer = setTimeout(done, 3000);
            });
            await route.continue();
            entry.finished = Date.now();
          }
        });
      try {
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await page.locator("#site-opening-curtain").waitFor({ state: "visible" });
        assert.equal(await page.getByText("直接进入", { exact: true }).count(), 0);
        assert.equal(await page.locator(".curtain-label").innerText(), "正在加载黑匣子");
        await page.evaluate(() => window.blackboxSiteOpening.update({ completed: 3, total: 7, discovering: false }));
        const closed = await page.evaluate(() => {
          const overlay = document.querySelector("#site-opening-curtain");
          const progress = overlay.querySelector("progress");
          const duration = getComputedStyle(overlay).getPropertyValue("--curtain-reveal-duration").trim();
          const durationMs = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
          const panel = overlay.querySelector(".curtain-panel").getBoundingClientRect();
          return {
            progress: { value: progress.value, max: progress.max },
            detail: overlay.querySelector(".curtain-detail").textContent,
            duration,
            durationMs,
            panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height },
            panelInViewport:
              panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        assert.equal(closed.progress.value, 3);
        assert.equal(closed.progress.max, 7);
        assert.equal(closed.panelInViewport, true);
        assert.equal(closed.overflow, false);
        assert.ok(
          closed.durationMs > 0 && closed.durationMs <= 1000,
          "Use the shared CSS reveal duration, up to 1000ms",
        );
        if (scenario === "normal" || scenario === "keyframe-sample")
          await page.waitForFunction(() => {
            const cloth = [...document.querySelectorAll(".curtain-cloth")];
            return cloth.length === 2 && cloth.every((image) => image.complete && image.naturalWidth > 0);
          });
        if (scenario === "normal" || scenario === "texture-failed") {
          await page.screenshot({ path: join(output, `${width}-${scenario}-closed.png`), animations: "allow" });
        }
        if (scenario === "texture-failed" || scenario === "texture-slow")
          assert.ok(
            textures.length > 0,
            "The decorative texture must really be requested to validate its failure/slow case",
          );

        if (scenario === "keyframe-sample") {
          const keyframe = await page.evaluate(() => {
            window.blackboxSiteOpening.finish({ status: "ready" });
            const overlay = document.querySelector("#site-opening-curtain");
            const duration = getComputedStyle(overlay).getPropertyValue("--curtain-reveal-duration").trim();
            const durationMs = Number.parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
            const animations = overlay
              .getAnimations({ subtree: true })
              .filter((animation) => animation.animationName?.startsWith("curtain-reveal"));
            for (const animation of animations) {
              animation.pause();
              animation.currentTime = durationMs * 0.45;
            }
            return {
              evidence: "Paused CSS animations sampled at 45%; visual keyframe only, not a live timing measurement",
              atMs: durationMs * 0.45,
              animations: animations.map((animation) => animation.animationName),
            };
          });
          assert.ok(keyframe.animations.length > 0, "Sample the actual reveal CSS animations");
          await page.screenshot({ path: join(output, `${width}-sampled-mid-reveal.png`), animations: "allow" });
          assert.equal(
            await page.locator("#site-opening-curtain").count(),
            1,
            "Keyframe must precede fallback cleanup",
          );
          results.push({ width, scenario, closed, keyframe, errors, consoleErrors, requestsFailed, responsesFailed });
          continue;
        }

        await measureStart(page, scenario === "preloader-failed" ? "preloader-failed" : "finish");
        let reducedChange;
        if (scenario === "reduced-during-reveal") {
          await page.waitForFunction(() => document.querySelector(".blackbox-curtain.is-revealing"));
          const before = Date.now();
          await page.emulateMedia({ reducedMotion: "reduce" });
          reducedChange = { emulateMediaRoundTripMs: Date.now() - before };
        }
        const timing = await page.evaluate(() => window.syntheticCurtainTiming);
        const after = await state(page);
        assert.equal(after.curtainCount, 0);
        assert.equal(after.active, false);
        assert.equal(after.modalCount, 0, "Closing must release the modal focus/inert barrier");
        assert.equal(after.overflow, false);
        assert.equal(after.headingVisible, true);
        assert.ok(
          timing.elapsedMs < closed.durationMs + 350,
          "Cleanup must follow the CSS duration without a separate loading hold",
        );
        if (scenario === "reduced") {
          assert.ok(timing.elapsedMs < 100, "Reduced motion clears synchronously without a reveal wait");
          assert.equal(timing.animationStarts.length, 0);
        }
        if (scenario === "preloader-failed") {
          assert.equal(after.opening, "partial");
          assert.ok(responsesFailed.some((entry) => entry.path === "/synthetic-preloader-failure.js"));
        }
        if (scenario === "texture-slow") {
          assert.equal(
            textures[0].finished,
            null,
            "Curtain must finish while the 3-second texture request is still pending",
          );
          assert.ok(timing.elapsedMs < 2000, "No waiting for the decorative image load/decode");
          await page.waitForResponse((response) => new URL(response.url()).pathname === texturePath);
        }
        assert.deepEqual(errors, []);
        await page.locator("main a").focus();
        assert.equal(await page.locator("main a").evaluate((link) => document.activeElement === link), true);
        if (scenario === "normal")
          await page.screenshot({ path: join(output, `${width}-normal-finished.png`), animations: "allow" });
        results.push({
          width,
          scenario,
          closed,
          timing,
          after,
          reducedChange,
          textures,
          errors,
          consoleErrors,
          requestsFailed,
          responsesFailed,
        });
        console.log(
          JSON.stringify({ width, scenario, cleanupMs: timing.elapsedMs, firstMovementMs: timing.firstMovementMs }),
        );
      } finally {
        clearTimeout(holdTimer);
        await context.close();
      }
    }
  }
} finally {
  writeFileSync(
    join(output, "metrics.json"),
    JSON.stringify(
      {
        evidence: "Headless Edge rendering of synthetic HTML with current public files; no production data",
        browser: await browser.version(),
        limitation:
          "Keyframe screenshots explicitly pause/seek CSS animations; timing rows use separate unpaused runs. Screenshots need human visual inspection. Native navigation is covered separately by check-work-curtain-browser.mjs.",
        results,
      },
      null,
      2,
    ) + "\n",
  );
  await browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
