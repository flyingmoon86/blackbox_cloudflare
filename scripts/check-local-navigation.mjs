import { launchBrowser, evidenceDirectory } from "./browser/runtime.mjs";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
const output = evidenceDirectory("local-navigation", process.env.NAVIGATION_EVIDENCE);
const fixture = await navigationFixture();
const browser = await launchBrowser();
const evidence = [];
const paths = ["/", "/productions", "/members", "/resources", "/thanks", "/help", "/announcements"];
try {
  for (const profile of [
    { name: "desktop", viewport: { width: 1366, height: 768 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: "reduced", viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" },
  ]) {
    const ctx = await browser.newContext(profile);
    const page = await ctx.newPage();
    const errors = [];
    const browserRequests = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/^https?:/.test(request.url())) browserRequests.push(new URL(request.url()).pathname);
    });
    await page.addInitScript(() => {
      window.__routeTimes = [];
      document.addEventListener("blackbox:page-changed", (event) => {
        const at = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            window.__routeTimes.push({ ...event.detail, frameMs: performance.now() - at + event.detail.commitMs }),
          ),
        );
      });
    });
    fixture.faults.path = "/members";
    fixture.faults.delay = 1500;
    await page.goto(fixture.origin, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".blackbox-curtain.is-loading");
    await page.screenshot({ path: `${output}/${profile.name}-loading.png` });
    const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
    assert.equal(ready.status, "ready", JSON.stringify(ready));
    await page.waitForSelector(".blackbox-curtain", { state: "detached" });
    if (await page.locator(".test-notice[open]").count()) await page.locator(".test-notice button").click();
    fixture.faults.delay = 0;
    await page.waitForTimeout(300);
    const start = fixture.requests.length;
    const browserStart = browserRequests.length;
    await ctx.setOffline(true);
    // Actual mouse/touch activation of the persistent main navigation.
    const primary = profile.isMobile
      ? '.mobile-nav a[href="/productions"]'
      : '#main-navigation .nav-menu-link[href="/productions"]';
    if (profile.hasTouch) await page.locator(primary).tap();
    else await page.locator(primary).click();
    await page.waitForURL("**/productions");
    assert.equal(await page.locator('.nav-menu-link[href="/productions"]').getAttribute("aria-current"), "page");
    await page.screenshot({ path: `${output}/${profile.name}-productions-offline.png`, animations: "disabled" });
    for (const path of [...paths.slice(2), "/"]) {
      // Use existing links; list-page coverage includes submenus and the home notice.
      await page.evaluate((path) => {
        let link = [...document.querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === path);
        if (!link) {
          link = document.createElement("a");
          link.href = path;
          link.textContent = "验收导航";
          document.querySelector("main").append(link);
        }
        link.click();
      }, path);
      await page.waitForURL(fixture.origin + path);
      assert.equal(await page.locator(".blackbox-curtain").count(), 0);
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll("main img[src]")].some((img) => !img.complete || !img.naturalWidth),
        ),
        false,
        path,
      );
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, path);
    }
    // Keyboard works after returning home; global handlers must not multiply.
    await page.locator(primary).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL("**/productions");
    await page.goBack();
    await page.waitForURL(fixture.origin + "/");
    await page.goForward();
    await page.waitForURL("**/productions");
    await page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
    const savedY = await page.evaluate(() => scrollY);
    await page.evaluate(() => document.querySelector('.nav-menu-link[href="/members"]').click());
    await page.waitForURL("**/members");
    await page.goBack();
    await page.waitForURL("**/productions");
    assert.equal(await page.evaluate(() => scrollY), savedY, "Back restores the previous list scroll");
    await page.evaluate(() => {
      for (const path of ["/members", "/thanks", "/", "/productions", "/members"])
        [...document.querySelectorAll(".top a,.mobile-nav a")].find((a) => a.getAttribute("href") === path).click();
    });
    await page.waitForURL("**/members");
    await page.waitForTimeout(200);
    assert.equal(fixture.requests.length, start, "Offline switches must reach no server endpoint");
    assert.deepEqual(browserRequests.slice(browserStart), [], "Offline switches must not even attempt HTTP requests");
    await ctx.setOffline(false);
    const onlineStart = fixture.requests.length;
    for (const path of ["/thanks", "/", "/productions", "/members", "/"]) {
      await page.evaluate(
        (path) =>
          [...document.querySelectorAll(".top a,.mobile-nav a")].find((a) => a.getAttribute("href") === path).click(),
        path,
      );
      await page.waitForURL(fixture.origin + path);
    }
    await page.locator("main").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.locator(".theatre-stage").getAttribute("data-active-scene"), "playbill");
    await page.waitForTimeout(300);
    assert.equal(fixture.requests.length, onlineStart, "Online cached switches must also make zero server requests");
    assert.deepEqual(errors, []);
    evidence.push({
      profile: profile.name,
      ready,
      offline: true,
      networkRequests: fixture.requests.length - start,
      attemptedHTTP: browserRequests.length - browserStart,
      onlineRequests: fixture.requests.length - onlineStart,
      homeKeyboardRestored: true,
      times: await page.evaluate(() => window.__routeTimes),
      errors,
    });
    await ctx.close();
  }
  // Signed-in chrome survives; anonymous snapshots never contain admin records.
  for (const role of ["admin", "member", "user"]) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${fixture.origin}/__fixture/session/${role}`);
    assert.equal((await page.evaluate(() => window.blackboxNavigation.startupPromise)).status, "ready");
    await page.evaluate(() => document.querySelector('.nav-menu-link[href="/productions"]').click());
    await page.waitForURL("**/productions");
    assert.equal(await page.locator(".account-link").getAttribute("href"), "/profile");
    assert.equal((await page.locator("main").innerText()).includes("PRIVATE_HIDDEN_PRODUCTION"), false);
    assert.equal(await page.locator('main input[name="csrf"]').count(), 0);
    const cachedKeys = await page.evaluate(async () =>
      (
        await Promise.all(
          (await caches.keys()).map(async (name) =>
            (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
          ),
        )
      ).flat(),
    );
    assert.ok(
      cachedKeys.every((p) => /^\/(assets|fonts)\//.test(p)),
      JSON.stringify(cachedKeys),
    );
    evidence.push({ role, chromePreserved: true, privateContentAbsent: true, persistentCacheOnlyStatic: true });
    await ctx.close();
  }
  // A failed page releases the curtain honestly and retains normal links.
  fixture.faults.path = "/members";
  fixture.faults.fail = true;
  const failureContext = await browser.newContext();
  const failedPage = await failureContext.newPage();
  await failedPage.goto(fixture.origin);
  const partial = await failedPage.evaluate(() => window.blackboxNavigation.startupPromise);
  assert.equal(partial.status, "partial");
  assert.equal(await failedPage.evaluate(() => window.blackboxNavigation.cached("/members")), false);
  await failedPage.waitForSelector(".blackbox-curtain", { state: "detached" });
  fixture.faults.fail = false;
  await failedPage.evaluate(() => document.querySelector('.nav-menu-link[href="/members"]').click());
  await failedPage.waitForURL("**/members");
  evidence.push({ failureRecovery: partial.status, nativeFallback: true });
  await failureContext.close();
  // Direct entry, refresh, disabled storage/JS, missing image and failed runtime.
  fixture.faults.path = "";
  const directContext = await browser.newContext({ serviceWorkers: "block" });
  const direct = await directContext.newPage();
  await direct.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw Error("disabled storage");
      },
    });
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("disabled storage");
      },
    });
  });
  await direct.goto(fixture.origin + "/members");
  assert.equal((await direct.evaluate(() => window.blackboxNavigation.startupPromise)).status, "ready");
  await direct.reload();
  assert.equal((await direct.evaluate(() => window.blackboxNavigation.startupPromise)).status, "ready");
  await direct.evaluate(() => document.querySelector(".brand").click());
  await direct.waitForURL(fixture.origin + "/");
  assert.equal(await direct.locator(".theatre-stage.stage-ready").count(), 1);
  await directContext.close();
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noJS.newPage();
  await plain.goto(fixture.origin);
  await plain.locator('.nav-menu-link[href="/productions"]').click();
  await plain.waitForURL("**/productions");
  assert.equal(await plain.locator("main h1").innerText(), "作品档案");
  await noJS.close();
  for (const fault of ["image", "runtime"]) {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.route(fault === "image" ? "**/productions/1/cover?*" : "**/assets/page-runtime.*.js", (route) =>
      route.abort(),
    );
    await page.goto(fixture.origin);
    if (fault === "image")
      assert.equal((await page.evaluate(() => window.blackboxNavigation.startupPromise)).status, "partial");
    await page.waitForSelector(".blackbox-curtain", { state: "detached" });
    assert.equal(await page.locator("main").count(), 1);
    await ctx.close();
  }
  evidence.push({
    directEntryRefresh: true,
    blockedStorageAndServiceWorker: true,
    noJSNativeLinks: true,
    failedImageHonestPartial: true,
    failedRuntimeReleasesCurtain: true,
  });
  const accountContext = await browser.newContext();
  const accountPage = await accountContext.newPage();
  await accountPage.goto(fixture.origin);
  await accountPage.evaluate(() => window.blackboxNavigation.startupPromise);
  const loginTab = await accountContext.newPage();
  await loginTab.goto(fixture.origin + "/login");
  await accountPage.waitForFunction(() => !window.blackboxNavigation.cached("/productions"));
  await accountPage.evaluate(() => document.querySelector('.nav-menu-link[href="/productions"]').click());
  await accountPage.waitForURL("**/productions");
  evidence.push({ accountChangeInvalidatesOtherTab: true });
  await accountContext.close();
  writeFileSync(`${output}/results.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
  await fixture.close();
}
