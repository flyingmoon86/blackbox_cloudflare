import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const dir = "docs/evidence/2026-09-18-immersive";
mkdirSync(dir, { recursive: true });
const phase = process.argv[2] || "after";
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 768 },
      hasTouch: width === 390,
    });
    await page.goto("http://127.0.0.1:8787/productions?view=timeline");
    const paths = await page.locator(".timeline-link").evaluateAll((nodes) => nodes.map((n) => n.href));
    for (const path of paths) {
      await page.goto(path);
      if ((await page.locator("[data-photo-lightbox]").count()) > 1) break;
    }
    const original = page.url();
    const link = page.locator("[data-photo-lightbox]").first();
    await link.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${dir}/${phase}-${width}.png` });
    if (phase === "before") {
      await page.close();
      continue;
    }
    assert.equal(await page.locator("[data-photo-dialog]").evaluate((d) => d.open), true);
    await page.keyboard.press("ArrowRight");
    assert.match(await page.locator("[data-photo-position]").innerText(), /^2 /);
    if (width === 390) {
      const client = await page.context().newCDPSession(page);
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 290, y: 400 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 100, y: 400 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.match(await page.locator("[data-photo-position]").innerText(), /^3 /);
    }
    const locked = await page.evaluate(() => getComputedStyle(document.documentElement).overflow);
    assert.equal(locked, "hidden");
    await page.keyboard.press("Escape");
    await page.waitForURL(original);
    assert.equal(await link.evaluate((n) => n === document.activeElement), true);
    await link.click();
    await page.goBack();
    assert.equal(await page.locator("[data-photo-dialog]").evaluate((d) => d.open), false);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await link.click();
    const metrics = await page.locator("[data-photo-dialog]").evaluate((d) => ({
      overflow: d.scrollWidth > d.clientWidth,
      height: d.getBoundingClientRect().height,
      viewport: innerHeight,
      left: d.getBoundingClientRect().left,
      right: d.getBoundingClientRect().right,
    }));
    assert.equal(metrics.overflow, false);
    console.log(
      JSON.stringify({
        metrics,
        style: await page.locator("[data-photo-dialog]").evaluate((d) => {
          const s = getComputedStyle(d);
          return {
            left: s.left,
            right: s.right,
            margin: s.margin,
            width: s.width,
            transform: s.transform,
            position: s.position,
          };
        }),
      }),
    );
    assert.ok(metrics.left >= 0 && metrics.right <= width);
    assert.ok(metrics.height <= (width === 390 ? 844 : 768));
    await page.locator("[data-photo-image]").dispatchEvent("error");
    assert.equal(await page.locator("[data-photo-error]").isVisible(), true);
    await page.locator("[data-photo-close]").click();
    await page.waitForURL(original);
    if (width === 1366) {
      await page.setViewportSize({ width: 1366, height: 500 });
      await link.click();
      const closeRect = await page.locator("[data-photo-close]").boundingBox();
      assert.ok(closeRect.y >= 0 && closeRect.y + closeRect.height < 500);
      await page.screenshot({ path: `${dir}/after-low-height.png` });
      await page.mouse.click(1, 1);
      assert.equal(await page.locator("[data-photo-dialog]").evaluate((d) => d.open), false);
    }
    const native = await browser.newPage({ javaScriptEnabled: false });
    await native.goto(original);
    await native.locator("[data-photo-lightbox]").first().click();
    assert.match(native.url(), /\/resources\/\d+/);
    await native.close();
    console.log(JSON.stringify({ width, original, metrics, keyboard: true, back: true, errorRecovery: true }));
    await page.close();
  }
} finally {
  await browser.close();
}
