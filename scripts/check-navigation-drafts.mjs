import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
import { launchBrowser, evidenceDirectory, waitForPageReady } from "./browser/runtime.mjs";

const output = evidenceDirectory("navigation-drafts");
const fixture = await navigationFixture();
const browser = await launchBrowser();
const result = { synthetic: true, browser: browser.version(), checks: [], errors: [], passed: false };
const check = (name, value) => {
  assert.ok(value, name);
  result.checks.push(name);
  console.log("Passed:", name);
};
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 768 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    const ready = async () => {
      await page.waitForLoadState("domcontentloaded");
      await page.evaluate(() => window.blackboxNavigation?.startupPromise);
      await waitForPageReady(page);
    };
    const menu = async (path) => {
      // Resources are a submenu on mobile; the same native anchor is activated.
      await page.evaluate((path) => document.querySelector(`.top a[href="${path}"]`).click(), path);
      await page.waitForURL(fixture.origin + path);
    };
    try {
      await page.goto(fixture.origin + "/members");
      await ready();
      const start = fixture.requests.length;
      await context.setOffline(true);
      for (const path of ["/members", "/productions", "/resources"]) {
        await menu(path);
        const draft = `${path} 未提交搜索`;
        await page.locator('input[name="q"]').fill(draft);
        if (path === "/members") await page.locator('select[name="year"]').selectOption("2024");
        await menu("/thanks");
        await page.goBack();
        await page.waitForURL(fixture.origin + path);
        check(
          `${width} ${path} back keeps unsubmitted search`,
          (await page.locator('input[name="q"]').inputValue()) === draft,
        );
        if (path === "/members")
          check(
            `${width} back keeps year selection`,
            (await page.locator('select[name="year"]').inputValue()) === "2024",
          );
        await page.screenshot({ path: join(output, `after-${width}-${path.slice(1)}.png`), animations: "disabled" });
        await page.goForward();
        await page.waitForURL(fixture.origin + "/thanks");
        await page.goBack();
        await page.waitForURL(fixture.origin + path);
        check(
          `${width} ${path} repeated history keeps draft`,
          (await page.locator('input[name="q"]').inputValue()) === draft,
        );
      }
      await menu("/members");
      check(
        `${width} fresh visit starts with server defaults`,
        (await page.locator('input[name="q"]').inputValue()) === "",
      );
      check(`${width} fresh year starts empty`, (await page.locator('select[name="year"]').inputValue()) === "");
      await page.locator('input[name="q"]').fill("第一次访问");
      await menu("/productions");
      await menu("/members");
      await page.locator('input[name="q"]').fill("第二次访问");
      await page.evaluate(() => history.go(-2));
      await page.waitForFunction(() => document.querySelector('input[name="q"]').value === "第一次访问");
      check(`${width} same URL history entries stay independent`, true);
      await page.evaluate(() => history.go(2));
      await page.waitForFunction(() => document.querySelector('input[name="q"]').value === "第二次访问");
      const before = await page.evaluate(() => {
        window.draftRoot = document.querySelector("main");
        return history.length;
      });
      const currentLink = page.locator(
        width === 390 ? '.mobile-nav a[href="/members"]' : '.top .nav-menu-link[href="/members"]',
      );
      if (width === 390) await currentLink.tap();
      else await currentLink.press("Enter");
      check(
        `${width} repeated current link creates no history`,
        (await page.evaluate(() => history.length)) === before,
      );
      check(
        `${width} repeated current link keeps DOM and draft`,
        await page.evaluate(
          () =>
            window.draftRoot === document.querySelector("main") &&
            document.querySelector('input[name="q"]').value === "第二次访问",
        ),
      );
      await page.goBack();
      await page.waitForURL(fixture.origin + "/productions");
      check(`${width} one Back reaches previous page`, true);
      check(`${width} cached draft restoration makes no requests`, fixture.requests.length === start);
      check(
        `${width} history metadata contains no search text`,
        await page.evaluate(() => !JSON.stringify(history.state).includes("访问")),
      );
      check(
        `${width} fits viewport`,
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      );
      await context.setOffline(false);
      await menu("/resources");
      await page.locator('input[name="q"]').fill("合成查询");
      await page.locator('input[name="q"]').press("Enter");
      await page.waitForURL((url) => url.pathname === "/resources" && url.searchParams.get("q") === "合成查询");
      check(`${width} search still submits to server`, true);
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(result, null, 2));
  await browser.close();
  await fixture.close();
}
