import assert from "node:assert/strict";
import { waitForPageReady } from "./runtime.mjs";

export async function checkMemberNavigation(browser, origin) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.memberPositionWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("member-results:")) window.memberPositionWrites++;
        return original.call(this, key, value);
      };
    });
    try {
      await page.goto(origin);
      await page.waitForFunction(() => Boolean(window.blackboxNavigation?.startupPromise));
      await page.evaluate(() => window.blackboxNavigation.startupPromise);
      await waitForPageReady(page);
      // Repeated cached mounts must neither lose initialization nor accumulate listeners.
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.querySelector('a[href="/members"]').click());
        await page.waitForURL("**/members");
        if (i < 2) {
          await page.evaluate(() => document.querySelector('a[href="/"]').click());
          await page.waitForURL(origin + "/");
        }
      }
      assert.equal(await page.locator('script[src*="member-dossier."]').count(), 0);
      await page.evaluate(() => {
        document
          .querySelector(".member-card-link")
          .addEventListener("click", (event) => event.preventDefault(), { once: true });
        document.querySelector(".member-card-link").click();
      });
      assert.equal(await page.evaluate(() => window.memberPositionWrites), 1);
      await page.locator(".member-card-link").first().click();
      await page.waitForURL(/\/members\/1\?/);
      assert.ok(await page.evaluate(() => sessionStorage.getItem("member-results:page=1")));
      await page.locator("[data-member-return]").first().click();
      await page.waitForURL(/\/members\?page=1/);
      await waitForPageReady(page);
      // Verify a nonzero position, not merely the existence of a storage key.
      await page.goto(origin + "/members?q=" + encodeURIComponent("示例") + "&year=2024&page=1");
      await waitForPageReady(page);
      const key = "member-results:page=1&q=" + encodeURIComponent("示例") + "&year=2024";
      await page.evaluate((key) => {
        // One synthetic member fits on desktop; give the page real scroll range.
        const spacer = document.createElement("div");
        spacer.style.height = "2400px";
        document.querySelector("main").append(spacer);
        sessionStorage.setItem(key, JSON.stringify({ window: 140, main: 0 }));
        window.dispatchEvent(new PageTransitionEvent("pageshow"));
      }, key);
      await page.waitForFunction(() => scrollY >= 139);
      assert.equal(await page.evaluate(() => scrollY), 140);
      await page.goBack();
      await page.waitForURL(/\/members\?page=1/);
      await page.goForward();
      await page.waitForURL(/year=2024/);
      await waitForPageReady(page);
      assert.deepEqual(errors, []);
      results.push(`${width}: cached entry, single listener, detail return, filtered position and history`);
    } finally {
      await context.close();
    }
  }
  return results;
}
