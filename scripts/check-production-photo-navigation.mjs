import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser, evidenceDirectory, waitForPageReady, waitForImage } from "./browser/runtime.mjs";

// Read-only guest checks against a photo already visible on the public website.
const [version, resourceId, directory] = process.argv.slice(2);
assert.ok(["before", "after"].includes(version), "Specify before or after");
assert.match(resourceId || "", /^\d+$/, "Specify a public photo ID");
const origin = "https://npublackbox.online";
const output = evidenceDirectory("production-photo-navigation", directory);
const result = {
  at: new Date().toISOString(),
  origin,
  identity: "guest",
  version,
  resourceId,
  profiles: [],
  passed: false,
};
const browser = await launchBrowser();
try {
  for (const profile of [
    { name: "desktop", viewport: { width: 1366, height: 768 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext({ ...profile, reducedMotion: "reduce" });
    const page = await context.newPage();
    const record = { profile: profile.name, viewport: profile.viewport, errors: [], failures: [], screenshots: [] };
    result.profiles.push(record);
    page.on("pageerror", (e) => record.errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) record.errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on("requestfailed", (r) => {
      if (!r.failure()?.errorText.includes("ERR_ABORTED"))
        record.failures.push({
          host: new URL(r.url()).hostname,
          path: new URL(r.url()).pathname,
          reason: r.failure()?.errorText,
        });
    });
    const shot = async (name) => {
      const path = `${version}-${profile.name}-${name}.png`;
      await page.screenshot({ path: resolve(output, path), animations: "disabled" });
      record.screenshots.push(path);
    };
    const photoUrl = `${origin}/resources/${resourceId}?origin=${resourceId}&page=1`;
    const response = await page.goto(photoUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert.equal(response.status(), 200);
    await waitForPageReady(page);
    await waitForImage(page.locator(".resource-detail-preview img"));
    const previous = await page.locator("[data-photo-previous]").getAttribute("href");
    const next = await page.locator("[data-photo-next]").getAttribute("href");
    const back = await page.locator(".resource-back-links a").first().getAttribute("href");
    record.links = { previous, next, back };
    assert.equal(await page.locator(".photo-position").count(), version === "before" ? 1 : 0);
    await shot("photo");
    await page.locator("[data-photo-navigation]").scrollIntoViewIfNeeded();
    await shot("navigation");
    const box = await page.locator("[data-photo-next]").boundingBox();
    record.navigationBox = box;
    record.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(record.horizontalOverflow, false);
    if (profile.hasTouch) await page.locator("[data-photo-next]").tap();
    else await page.locator("[data-photo-next]").click();
    await page.waitForURL(origin + next);
    await waitForPageReady(page);
    record.focusBeforeArrow = await page.evaluate(() => document.activeElement?.tagName);
    // Global arrow navigation intentionally ignores focused controls. Click the
    // heading to exercise page-level keyboard navigation after touch/click.
    await page.locator(".resource-detail h1").click();
    record.focusForArrow = await page.evaluate(() => document.activeElement?.tagName);
    await page.keyboard.press("ArrowLeft");
    await page.waitForURL(photoUrl);
    await waitForPageReady(page);
    await page.locator("[data-photo-previous]").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(origin + previous);
    await waitForPageReady(page);
    await page.locator(".resource-back-links a").first().click();
    await page.waitForURL(origin + back);
    await waitForPageReady(page);
    const gallery = page.locator(`[data-photo-lightbox][href^="/resources/${resourceId}?"]`);
    await gallery.waitFor({ state: "visible" });
    record.returnUrl = page.url();
    record.returnTargetBox = await gallery.boundingBox();
    await shot("return");
    record.checks = { next: true, arrowPrevious: true, keyboardPrevious: true, returnContext: true };
    assert.deepEqual(record.errors, []);
    // Cloudflare's optional injected analytics beacon is blocked by the site's existing CSP.
    // Keep it in the evidence, but fail on every other network error.
    assert.deepEqual(
      record.failures.filter(
        (r) =>
          !(r.host === "static.cloudflareinsights.com" && r.path.startsWith("/beacon.min.js/") && r.reason === "csp"),
      ),
      [],
    );
    await context.close();
  }
  result.passed = true;
} catch (error) {
  result.error = error.message;
  throw error;
} finally {
  writeFileSync(resolve(output, `${version}-results.json`), JSON.stringify(result, null, 2) + "\n");
  await browser.close();
}
console.log(JSON.stringify(result, null, 2));
