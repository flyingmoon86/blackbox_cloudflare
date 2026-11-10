import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
import { launchBrowser, evidenceDirectory, waitForPageReady } from "./browser/runtime.mjs";

const output = evidenceDirectory("return-navigation");
const fixture = await navigationFixture(0, ({ db }) => {
  for (let id = 2; id <= 52; id++)
    db.prepare("INSERT INTO member(id,name,bio,join_year) VALUES(?,?,?,2024)").run(
      id,
      `示例队员 ${String(id).padStart(2, "0")}`,
      "用于列表返回回归的合成档案。",
    );
});
// A fresh document is essential: BFCache can hide broken history restoration.
const browser = await launchBrowser({ args: ["--disable-features=BackForwardCache"] });
const result = { browser: browser.version(), synthetic: true, bfcache: false, checks: [], errors: [], passed: false };
const check = (name, value) => {
  assert.ok(value, name);
  result.checks.push(name);
  console.log("Passed:", name);
};
const ready = async (page, javaScript = true) => {
  await page.waitForLoadState("domcontentloaded");
  await waitForPageReady(page);
  await page.evaluate(() => window.blackboxNavigation?.startupPromise);
  if (javaScript)
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  else await page.waitForLoadState("load");
};
const samePosition = async (page, y, name) => check(name, Math.abs((await page.evaluate(() => scrollY)) - y) <= 1);
try {
  for (const [device, width, height] of [
    ["desktop", 1366, 768],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      isMobile: device === "mobile",
      hasTouch: device === "mobile",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    const activate = (link) => (device === "mobile" ? link.tap() : link.press("Enter"));
    try {
      for (const [kind, path, selector, back] of [
        ["works", "/productions", "[data-work-card] h2 a", "[data-work-return]"],
        ["members", "/members", ".member-card-link", "[data-member-return]"],
        [
          "filtered-members",
          "/members?q=" + encodeURIComponent("示例") + "&year=2024&page=2",
          ".member-card-link",
          "[data-member-return]",
        ],
      ]) {
        await page.goto(fixture.origin + path);
        await ready(page);
        const link = page.locator(selector).last();
        await link.scrollIntoViewIfNeeded();
        const y = await page.evaluate(() => scrollY);
        check(`${device} ${kind} exercises a scrolled list`, y > 300);
        const destination = await link.getAttribute("href");
        await activate(link);
        await page.waitForURL(fixture.origin + destination);
        await ready(page);
        await activate(page.locator(back).first());
        await page.waitForURL(fixture.origin + path);
        await ready(page);
        await samePosition(page, y, `${device} ${kind} explicit return restores position`);
        check(
          `${device} ${kind} explicit return restores focus`,
          (await page.evaluate(() => document.activeElement?.getAttribute("href"))) === destination,
        );
        if (kind === "filtered-members") {
          check(`${device} search survives`, (await page.locator('input[name="q"]').inputValue()) === "示例");
          check(`${device} year survives`, (await page.locator('select[name="year"]').inputValue()) === "2024");
        }
        await activate(page.locator(selector).last());
        await page.waitForURL(fixture.origin + destination);
        await ready(page);
        await page.goBack();
        await ready(page);
        await samePosition(page, y, `${device} ${kind} history return survives a new document`);
        check(
          `${device} ${kind} history return restores focus`,
          (await page.evaluate(() => document.activeElement?.getAttribute("href"))) === destination,
        );
        await page.screenshot({ path: join(output, `${device}-${kind}-returned.png`), animations: "disabled" });
        await page.goForward();
        await page.waitForURL(fixture.origin + destination);
        await ready(page);
      }
      await page.locator(".brand").click();
      await page.waitForURL(fixture.origin + "/");
      await ready(page);
      const menu = async (path) => {
        await page.evaluate((path) => document.querySelector(`.nav-menu-link[href="${path}"]`).click(), path);
        await page.waitForURL(fixture.origin + path);
        await ready(page);
      };
      await menu("/members");
      await samePosition(page, 0, `${device} fresh menu entry ignores old detail position`);
      await page.evaluate(() => scrollTo({ top: 600, behavior: "instant" }));
      await menu("/productions");
      await page.evaluate(() => scrollTo({ top: 400, behavior: "instant" }));
      await page.goBack();
      await ready(page);
      await samePosition(page, 600, `${device} cached history returns to members`);
      await page.goForward();
      await ready(page);
      await samePosition(page, 400, `${device} cached history returns to works`);
      await page.evaluate(() => {
        for (const path of ["/members", "/productions", "/members", "/productions"])
          document.querySelector(`.nav-menu-link[href="${path}"]`).click();
      });
      await ready(page);
      await samePosition(page, 0, `${device} rapid menu switches cannot restore an old position`);
      check(
        `${device} fits viewport`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      );
    } finally {
      await context.close();
    }
  }

  for (const mode of ["storage-blocked", "no-js"]) {
    const context = await browser.newContext({ reducedMotion: "reduce", javaScriptEnabled: mode !== "no-js" });
    if (mode === "storage-blocked")
      await context.addInitScript(() => {
        for (const name of ["localStorage", "sessionStorage"])
          Object.defineProperty(window, name, {
            get() {
              throw new DOMException("Storage disabled", "SecurityError");
            },
          });
      });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    try {
      const path = "/members?q=" + encodeURIComponent("示例") + "&year=2024&page=2";
      await page.goto(fixture.origin + path);
      await ready(page, mode !== "no-js");
      const link = page.locator(".member-card-link").last();
      await link.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      await link.click();
      await page.waitForURL(/\/members\/\d+\?/);
      await ready(page, mode !== "no-js");
      await page.goBack();
      await ready(page, mode !== "no-js");
      await samePosition(page, y, `${mode} keeps native history restoration`);
      await page.locator(".member-card-link").last().click();
      await page.waitForURL(/\/members\/\d+\?/);
      await page.locator("[data-member-return]").first().click();
      await page.waitForURL(fixture.origin + path);
      check(`${mode} keeps native filtered return links`, true);
    } finally {
      await context.close();
    }
  }
  // Playwright normally disables BFCache. Also exercise a real persisted page
  // when the installed browser allows it, and record whether it actually did.
  const cachedBrowser = await launchBrowser({ ignoreDefaultArgs: ["--disable-back-forward-cache"] });
  try {
    const context = await cachedBrowser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    await page.addInitScript(() => {
      addEventListener("pageshow", (event) => (window.returnWasPersisted = event.persisted));
    });
    await page.goto(fixture.origin + "/members");
    await ready(page);
    const link = page.locator(".member-card-link").last();
    await link.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => scrollY);
    const destination = await link.getAttribute("href");
    await link.click();
    await page.waitForURL(fixture.origin + destination);
    await ready(page);
    await page.goBack({ waitUntil: "commit" });
    // A persisted document fires pageshow, not another load/DOMContentLoaded.
    await page.waitForFunction(() => document.readyState === "complete" && window.returnWasPersisted !== undefined);
    await waitForPageReady(page);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    result.persistedPageObserved = await page.evaluate(() => window.returnWasPersisted === true);
    await samePosition(page, y, "BFCache-enabled browser preserves return position");
    check(
      "BFCache-enabled browser preserves card focus",
      (await page.evaluate(() => document.activeElement?.getAttribute("href"))) === destination,
    );
    await context.close();
  } finally {
    await cachedBrowser.close();
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(result, null, 2));
  await browser.close();
  await fixture.close();
}
console.log("List return checks:", result.checks.length, "passed.");
