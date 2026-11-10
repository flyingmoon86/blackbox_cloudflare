import { launchBrowser, evidenceDirectory } from "./browser/runtime.mjs";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
const output = evidenceDirectory("opening-speed", process.env.OPENING_EVIDENCE);
const baseline = resolve(process.env.OPENING_BASELINE || output);
const production = process.argv.includes("--production");
const fixture = production ? null : await navigationFixture();
const origin = production ? "https://npublackbox.online" : fixture.origin;
const browser = await launchBrowser();
const results = [];
const save = () =>
  writeFileSync(`${output}/${production ? "public-network" : "local"}-results.json`, JSON.stringify(results, null, 2));
try {
  // Same data, viewport and deterministic HTML latency; new contexts each run.
  // Production mode overrides only the browser's received JS/CSS, never deploys.
  for (const variant of ["before", "after", "before", "after"]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.route("**/assets/navigation-preload.*.js", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: readFileSync(
          variant === "before" ? `${baseline}/navigation-before.js` : "public/navigation-preload.js",
          "utf8",
        ),
      }),
    );
    await page.route("**/assets/curtain.*.css", (route) =>
      route.fulfill({
        contentType: "text/css",
        body: readFileSync(variant === "before" ? `${baseline}/curtain-before.css` : "public/curtain.css", "utf8"),
      }),
    );
    if (!production)
      await page.route(/\/(?:productions|members|resources|thanks|help|announcements)?$/, async (route) => {
        if (route.request().resourceType() === "fetch") await new Promise((done) => setTimeout(done, 400));
        await route.continue();
      });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const start = Date.now();
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.blackboxNavigation?.startupPromise);
    const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
    const duration = Date.now() - start;
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((r) => ["fetch", "css"].includes(r.initiatorType))
        .map((r) => ({
          path: new URL(r.name).pathname,
          start: r.startTime,
          duration: r.duration,
          bytes: r.transferSize,
        })),
    );
    results.push({ kind: "preparation", variant, duration, ready, errors, resources });
    save();
    console.log(JSON.stringify({ variant, duration, status: ready.status, errors }));
    assert.equal(ready.status, "ready");
    assert.equal(errors.length, 0);
    await ctx.close();
  }
  if (!production)
    for (const profile of [
      { name: "desktop", viewport: { width: 1366, height: 768 } },
      { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      { name: "reduced", viewport: { width: 390, height: 844 }, reducedMotion: "reduce" },
    ]) {
      fixture.faults.path = "/members";
      fixture.faults.delay = profile.name === "reduced" ? 500 : 14500;
      const ctx = await browser.newContext(profile);
      const page = await ctx.newPage();
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".blackbox-curtain.is-loading");
      if (profile.name !== "reduced") {
        await page.waitForTimeout(13000);
        const held = await page.locator(".blackbox-curtain").evaluate((node) => ({
          visibility: getComputedStyle(node).visibility,
          loading: node.classList.contains("is-loading"),
        }));
        assert.deepEqual(held, { visibility: "visible", loading: true });
        await page.screenshot({ path: `${output}/${profile.name}-loading-after-13s.png` });
        await page.waitForSelector(".blackbox-curtain.is-revealing");
        await page.waitForTimeout(250);
        const reveal = await page.locator(".blackbox-curtain").evaluate((node) => ({
          visibility: getComputedStyle(node).visibility,
          background: getComputedStyle(node).backgroundColor,
          transform: getComputedStyle(node.querySelector(".curtain-wing-left")).transform,
          animations: node.getAnimations({ subtree: true }).map((a) => a.animationName),
        }));
        assert.equal(reveal.visibility, "visible");
        assert.equal(reveal.background, "rgba(0, 0, 0, 0)");
        assert.ok(reveal.animations.includes("curtain-reveal-left"));
        assert.notEqual(reveal.transform, "none");
        await page.screenshot({ path: `${output}/${profile.name}-reveal.png` });
        results.push({ kind: "animation", profile: profile.name, held, reveal });
      }
      const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
      assert.equal(ready.status, "ready");
      await page.waitForSelector(".blackbox-curtain", { state: "detached" });
      if (profile.name === "reduced") results.push({ kind: "reduced-motion", ready });
      save();
      await ctx.close();
    }
} finally {
  await browser.close();
  await fixture?.close();
}
