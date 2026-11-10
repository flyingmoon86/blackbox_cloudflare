import { launchBrowser, evidenceDirectory } from "./browser/runtime.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
const output = evidenceDirectory("curtain-opening/browser", process.env.CURTAIN_EVIDENCE);
const baseline = resolve(output, "../before");
const fixture = await navigationFixture();
const browser = await launchBrowser();
const results = [];
try {
  if (process.argv.includes("--smooth")) {
    const curves = [];
    for (const width of [1366, 390]) {
      for (const before of [true, false]) {
        const ctx = await browser.newContext({ viewport: { width, height: 844 } });
        const page = await ctx.newPage();
        const css = readFileSync(before ? resolve(baseline, "public__curtain.css") : "public/curtain.css", "utf8");
        await page.setContent(
          `<style>${css}</style><div id="site-opening-curtain" class="blackbox-curtain is-revealing"><div class="curtain-wing curtain-wing-left"></div><div class="curtain-wing curtain-wing-right"></div></div>`,
        );
        const samples = await page.evaluate(() => {
          const left = document.querySelector(".curtain-wing-left"),
            right = document.querySelector(".curtain-wing-right");
          const animations = document.getAnimations();
          animations.forEach((a) => a.pause());
          const duration = animations[0].effect.getTiming().duration;
          const points = [];
          for (let step = 0; step <= 1000; step++) {
            animations.forEach((a) => {
              a.currentTime = (duration * step) / 1000;
            });
            points.push({
              t: step / 1000,
              left: left.getBoundingClientRect().right,
              right: right.getBoundingClientRect().left,
              clothWidth: left.getBoundingClientRect().width,
            });
          }
          return points;
        });
        const speeds = samples.slice(1).map((p, i) => ({ t: p.t, value: ((samples[i].left - p.left) / width) * 1000 }));
        const middle = speeds
          .filter((p) => p.t >= 0.15 && p.t <= 0.85)
          .map((p) => p.value)
          .sort((a, b) => a - b);
        const minimumToMedian = middle[0] / middle[Math.floor(middle.length / 2)];
        const monotonic = speeds.every((p) => p.value >= -0.001);
        if (!before) {
          assert.ok(monotonic, "The curtain must not reverse direction");
          assert.ok(minimumToMedian >= 0.08, `Unexpected internal stop: ${minimumToMedian}`);
          assert.ok(
            Math.max(...samples.map((p) => p.clothWidth)) - Math.min(...samples.map((p) => p.clothWidth)) < 0.5,
            "The moving curtain texture must retain its width instead of being squeezed",
          );
          assert.ok(
            samples.at(-1).left < 0 && samples.at(-1).right > width,
            "Both wings must fully clear the viewport",
          );
        }
        curves.push({ width, before, minimumToMedian, monotonic, samples });
        await ctx.close();
      }
    }
    writeFileSync(
      output + "/trajectory.json",
      JSON.stringify(
        {
          method:
            "CSS Web Animations paused and sought at 1001 equally spaced times; measures velocity shape independently of frame drops",
          curves,
        },
        null,
        2,
      ),
    );
  }
  for (const scenario of [
    { name: "before-desktop", before: true, width: 1366, height: 768 },
    { name: "after-desktop", width: 1366, height: 768, video: true },
    { name: "before-mobile", before: true, width: 390, height: 844, mobile: true },
    { name: "after-mobile", width: 390, height: 844, mobile: true, video: true },
    { name: "after-reduced", width: 390, height: 844, reduced: true },
    { name: "after-long-pull", width: 1366, height: 768, long: true },
    { name: "after-slow-preparation", width: 390, height: 844, mobile: true, slow: true },
  ]) {
    if (process.argv.includes("--smooth") && (scenario.long || scenario.slow)) continue;
    fixture.faults.path = "/";
    fixture.faults.delay = scenario.slow ? 3200 : 500;
    const viewport = { width: scenario.width, height: scenario.height };
    const ctx = await browser.newContext({
      viewport,
      isMobile: !!scenario.mobile,
      hasTouch: !!scenario.mobile,
      reducedMotion: scenario.reduced ? "reduce" : "no-preference",
      serviceWorkers: "block",
      ...(scenario.video ? { recordVideo: { dir: output + "/video", size: viewport } } : {}),
    });
    if (scenario.before) {
      for (const [pattern, file, type] of [
        ["**/assets/navigation-preload.*.js", "public__navigation-preload.js", "application/javascript"],
        ["**/assets/curtain-boot.*.js", "public__curtain-boot.js", "application/javascript"],
        ["**/assets/curtain.*.css", "public__curtain.css", "text/css"],
      ])
        await ctx.route(pattern, (r) =>
          r.fulfill({ contentType: type, body: readFileSync(resolve(baseline, file), "utf8") }),
        );
    }
    if (scenario.long)
      await ctx.route("**/assets/curtain.*.css", (r) =>
        r.fulfill({
          contentType: "text/css",
          body: readFileSync("public/curtain.css", "utf8").replace("2600ms", "4200ms"),
        }),
      );
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.__curtainCheck = { events: [], frames: [], ended: null };
      document.addEventListener("animationstart", (e) => {
        if (e.animationName !== "curtain-reveal-left") return;
        const log = window.__curtainCheck;
        log.start = performance.now();
        log.openingStatus = window.blackboxSiteOpening?.status;
        log.navigationStatus = window.blackboxNavigation?.status;
        const sample = () => {
          const root = document.querySelector("#site-opening-curtain");
          if (!root) return;
          const left = root.querySelector(".curtain-wing-left").getBoundingClientRect(),
            right = root.querySelector(".curtain-wing-right").getBoundingClientRect();
          log.frames.push({
            at: performance.now(),
            leftX: left.x,
            leftWidth: left.width,
            rightX: right.x,
            rightWidth: right.width,
          });
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      document.addEventListener("animationend", (e) => {
        if (/^curtain-reveal-/.test(e.animationName))
          window.__curtainCheck.events.push({ name: e.animationName, at: performance.now() });
      });
      document.addEventListener("blackbox:curtain-finished", () => {
        window.__curtainCheck.ended = performance.now();
      });
    });
    const start = Date.now();
    await page.goto(fixture.origin, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => window.blackboxNavigation?.startupPromise);
    const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
    const preparedMs = Date.now() - start;
    assert.equal(ready.status, "ready", JSON.stringify(ready));
    assert.equal(ready.routes.length, 7);
    if (!scenario.reduced) {
      await page.waitForFunction(() => window.__curtainCheck.start);
      if (scenario.slow) await page.screenshot({ path: output + "/" + scenario.name + "-start.png" });
      if (scenario.video) {
        await page.waitForTimeout(650);
        await page.screenshot({ path: output + "/" + scenario.name + "-quarter.png" });
        await page.waitForTimeout(1100);
        await page.screenshot({ path: output + "/" + scenario.name + "-late.png" });
      }
      if (scenario.long) {
        await page.waitForTimeout(2300);
        assert.equal(
          await page.locator(".blackbox-curtain.is-revealing").count(),
          1,
          "A long pull must not be cut at two seconds",
        );
      }
    }
    await page.waitForSelector(".blackbox-curtain", { state: "detached", timeout: 15000 });
    const rendered = await page.evaluate(() => ({
      timeline: window.__curtainCheck,
      overflow: document.documentElement.scrollWidth > innerWidth,
      resources: performance
        .getEntriesByType("resource")
        .filter((r) => r.initiatorType === "fetch")
        .map((r) => ({ path: new URL(r.name).pathname, duration: r.duration })),
      cached: ["/", "/members", "/resources", "/productions", "/thanks", "/help", "/announcements"].map((path) => ({
        path,
        ready: window.blackboxNavigation.cached(path),
      })),
    }));
    const frames = rendered.timeline.frames;
    const gaps = frames
      .slice(1)
      .map((f, i) => f.at - frames[i].at)
      .sort((a, b) => a - b);
    const duration = rendered.timeline.start ? rendered.timeline.ended - rendered.timeline.start : 0;
    assert.equal(rendered.overflow, false);
    assert.ok(rendered.cached.every((x) => x.ready));
    assert.equal(errors.length, 0, JSON.stringify(errors));
    if (!scenario.before && !scenario.reduced) {
      assert.equal(rendered.timeline.openingStatus, "ready");
      assert.equal(rendered.timeline.navigationStatus, "ready");
      assert.ok(duration >= (scenario.long ? 4000 : 2450), String(duration));
      assert.ok(rendered.timeline.events.some((e) => e.name === "curtain-reveal-left"));
      assert.ok(rendered.timeline.events.some((e) => e.name === "curtain-reveal-right"));
      assert.ok(frames.length > 10);
    }
    if (scenario.reduced) assert.equal(frames.length, 0);
    const result = {
      scenario: scenario.name,
      viewport,
      preparedMs,
      revealMs: Math.round(duration),
      frameCount: frames.length,
      p95FrameGapMs: gaps[Math.floor(gaps.length * 0.95)] || 0,
      maxFrameGapMs: gaps.at(-1) || 0,
      ready,
      errors,
      ...rendered,
    };
    results.push(result);
    writeFileSync(
      output + "/results.json",
      JSON.stringify(
        {
          capturedUtc: new Date().toISOString(),
          origin: fixture.origin,
          data: "仅本地合成资料；真实Worker，固定首页HTML延迟500ms，慢加载3200ms；每组独立冷上下文",
          results,
        },
        null,
        2,
      ),
    );
    const video = page.video();
    await ctx.close();
    if (scenario.video) await video.saveAs(output + "/" + scenario.name + ".webm");
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        preparedMs,
        revealMs: Math.round(duration),
        frameCount: frames.length,
        p95FrameGapMs: result.p95FrameGapMs,
      }),
    );
  }
} finally {
  await browser.close();
  await fixture.close();
}
