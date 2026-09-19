import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
const base = process.env.BASE_URL || "http://127.0.0.1:8788";
const dir = "docs/evidence/2026-09-19-edition-light";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 768 },
      hasTouch: width === 390,
    });
    await context.addInitScript(() => {
      window.lightEvents = [];
      document.addEventListener("animationstart", (e) => {
        if (e.animationName.startsWith("edition-light-")) window.lightEvents.push(e.animationName);
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(base + "/productions/991008", { waitUntil: "networkidle" });
    const link = page.locator('.edition-tabs a:not([aria-current="page"])').first();
    assert.ok(await link.count(), "Requires two existing local editions");
    const destination = await link.getAttribute("href");
    await link.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/${width}-before.png` });
    if (width === 390) await link.tap();
    else {
      await link.focus();
      await page.keyboard.press("Enter");
    }
    await page.waitForURL(base + destination);
    await page.waitForTimeout(600);
    assert.deepEqual((await page.evaluate(() => window.lightEvents)).sort(), [
      "edition-light-glow",
      "edition-light-reveal",
    ]);
    assert.equal(await page.locator(".edition-light-enter").count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${dir}/${width}-after.png` });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.evaluate(() => window.lightEvents)).length, 0);
    await page.goBack({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".edition-light-enter").count(), 0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('.edition-tabs a:not([aria-current="page"])').first().click();
    await page.waitForLoadState("networkidle");
    assert.equal((await page.evaluate(() => window.lightEvents)).length, 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // Freeze a real CSS animation frame for visual evidence only.
    await page.addInitScript(() => {
      document.addEventListener("animationstart", (event) => {
        if (!event.animationName.startsWith("edition-light-")) return;
        for (const animation of event.target.getAnimations()) {
          animation.pause();
          animation.currentTime = 100;
        }
      });
    });
    await page.locator('.edition-tabs a:not([aria-current="page"])').first().click();
    await page.waitForLoadState("domcontentloaded");
    await page.screenshot({ path: `${dir}/${width}-light-frame.png`, animations: "allow" });
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 844 } });
    const plain = await nojs.newPage();
    await plain.goto(base + "/productions/991008");
    await plain
      .locator(".edition-tabs")
      .evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await plain.locator('.edition-tabs a:not([aria-current="page"])').first().click();
    await plain.waitForURL(base + destination);
    assert.ok(await plain.locator(".edition-heading").isVisible());
    await nojs.close();
    console.log(
      JSON.stringify({
        width,
        animationMs: 400,
        keyboardOrTouch: true,
        back: true,
        reload: true,
        reducedMotion: true,
        noJS: true,
        overflow: false,
        errors,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
