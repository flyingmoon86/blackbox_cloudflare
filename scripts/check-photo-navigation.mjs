import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
import { launchBrowser, evidenceDirectory, waitForPageReady, waitForImage } from "./browser/runtime.mjs";

const output = evidenceDirectory("photo-navigation");
let edition;
const fixture = await navigationFixture(0, async ({ db, files }) => {
  edition = db.prepare("SELECT edition_id FROM resource WHERE id=1").get().edition_id;
  await files.put("photo-seek-preview.webp", readFileSync("public/images/productions-unlit.webp"), {
    httpMetadata: { contentType: "image/webp" },
  });
  db.exec("UPDATE production SET cover_id=NULL WHERE id=1; UPDATE resource SET res_type='other' WHERE id=1");
  const insert = db.prepare(`INSERT INTO resource(id,production_id,edition_id,title,filename,original_name,
    preview_filename,status,res_type,created_at) VALUES(?,1,?,'合成剧照','synthetic/'||?,
    'synthetic.webp','photo-seek-preview.webp','approved','photo','2026-11-15 12:00:00')`);
  for (let id = 101; id <= 105; id++) insert.run(id, edition, id);
});
const browser = await launchBrowser({ args: ["--no-proxy-server"] });
const result = { scope: "Synthetic local Worker, guest", checks: [], errors: [], screenshots: [], passed: false };
try {
  for (const [device, width, height] of [
    ["desktop", 1366, 768],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      ...(device === "mobile" ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => result.errors.push(e.message));
    page.on("response", (response) => {
      if (response.status() >= 400) result.errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    const go = async (id) => {
      const response = await page.goto(`${fixture.origin}/resources/${id}?origin=103&page=2`);
      assert.equal(response.status(), 200);
      await waitForPageReady(page);
      await waitForImage(page.locator(".resource-detail-preview img"));
    };
    await go(103);
    const nav = page.locator("[data-photo-navigation]");
    assert.equal(await nav.locator("a").count(), 2);
    assert.equal(await page.locator(".photo-position").count(), 0);
    await nav.scrollIntoViewIfNeeded();
    const screenshot = `${device}-photo-navigation.png`;
    await page.screenshot({ path: resolve(output, screenshot), animations: "disabled" });
    result.screenshots.push(screenshot);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator("[data-photo-next]").click();
    await page.waitForURL(/\/resources\/102\?origin=103&page=2/);
    await waitForPageReady(page);
    await page.keyboard.press("ArrowLeft");
    await page.waitForURL(/\/resources\/103\?origin=103&page=2/);
    await waitForPageReady(page);
    await page.locator("[data-photo-previous]").focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/resources\/104\?origin=103&page=2/);
    await waitForPageReady(page);
    await page.locator(".resource-back-links a").click();
    await page.waitForURL(
      new RegExp(`/productions/1\\?edition=${edition}&page=2&photo=103#edition-${edition}-resources`),
    );
    await go(105);
    assert.equal(await page.locator("[data-photo-previous]").count(), 0);
    assert.match(await nav.innerText(), /已是第一张/);
    await go(101);
    assert.equal(await page.locator("[data-photo-next]").count(), 0);
    assert.match(await nav.innerText(), /已是最后一张/);
    result.checks.push({
      device,
      viewport: { width, height },
      click: true,
      arrowKey: true,
      keyboardLink: true,
      firstAndLast: true,
      galleryContext: true,
      noHorizontalOverflow: true,
    });
    await context.close();
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  await browser.close();
  await fixture.close();
}
console.log(JSON.stringify(result));
