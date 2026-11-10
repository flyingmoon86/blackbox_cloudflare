import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { navigationFixture } from "./navigation-fixture.mjs";
import { launchBrowser, evidenceDirectory, waitForPageReady } from "./browser/runtime.mjs";
import { checkCreditClient } from "./browser/credit-client-checks.mjs";

const output = evidenceDirectory("component-isolation");
const fixture = await navigationFixture(
  0,
  ({ db }) => {
    for (let id = 2; id <= 52; id++)
      db.prepare("INSERT INTO member(id,name,join_year) VALUES(?,?,2024)").run(id, `示例队员 ${id}`);
  },
  { allowWrites: true },
);
const browser = await launchBrowser();
const result = { checks: [], errors: [], passed: false };
const check = (name, value) => {
  assert.ok(value, name);
  result.checks.push(name);
};
const ready = async (page) => {
  await page.waitForLoadState("domcontentloaded");
  await waitForPageReady(page);
  await page.evaluate(() => window.blackboxNavigation?.startupPromise);
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
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);
    page.on("pageerror", (error) => result.errors.push(error.message));
    try {
      const list = "/members?q=" + encodeURIComponent("示例") + "&year=2024&page=2";
      await page.goto(fixture.origin + list);
      await ready(page);
      check(
        `${width} public page excludes administrative scripts`,
        (await page
          .locator('script[src*="admin-notifications"],script[src*="credit-import"],script[src*="credit-forms"]')
          .count()) === 0,
      );
      await page.locator(".member-card-link").last().scrollIntoViewIfNeeded();
      const savedY = await page.evaluate(() => scrollY);
      await page.locator(".member-card-link").last().click();
      await page.waitForURL(/\/members\/\d+\?/);
      const id = new URL(page.url()).pathname;
      for (const status of ["sent", "already"]) {
        const [response] = await Promise.all([
          page.waitForResponse(
            (response) =>
              response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/flowers"),
          ),
          page.locator(".dossier-flower-action button").click(),
        ]);
        assert.equal(response.status(), 303, "flower POST must redirect after success");
        assert.equal(
          new URL(await response.headerValue("location"), fixture.origin).searchParams.get("flower"),
          status,
        );
        await page.waitForFunction(() => document.activeElement?.matches(".dossier-flower-action button"));
        await page
          .getByText(status === "sent" ? "今天的花已送达。" : "你今天已经送过花了，明天再来吧。", { exact: true })
          .waitFor();
        const url = new URL(page.url());
        check(
          `${width} ${status} keeps filters and page`,
          url.pathname === id &&
            url.searchParams.get("q") === "示例" &&
            url.searchParams.get("year") === "2024" &&
            url.searchParams.get("page") === "2",
        );
      }
      await page.screenshot({ path: join(output, `flowers-${width}.png`) });
      await page.locator("[data-member-return]").first().click();
      await page.waitForURL(fixture.origin + list);
      await page.waitForFunction((y) => Math.abs(scrollY - y) <= 1, savedY);
      check(
        `${width} returns to original filtered list`,
        (await page.locator('input[name="q"]').inputValue()) === "示例",
      );

      await page.goto(fixture.origin);
      await ready(page);
      await page.evaluate(() => {
        window.componentProbe = { calls: 0, released: 0, healthy: 0 };
        window.blackboxPages.register("synthetic-setup-failure", (_, scope) => {
          scope.listen(window, "component-probe", () => window.componentProbe.calls++);
          throw Error("synthetic initialization fault");
        });
        window.blackboxPages.register("synthetic-cleanup-failure", (_, scope) => {
          scope.dispose(() => window.componentProbe.released++);
          scope.dispose(() => {
            throw Error("synthetic cleanup fault");
          });
        });
        window.blackboxPages.register("synthetic-healthy", () => window.componentProbe.healthy++);
      });
      for (const path of ["/members", "/productions", "/members"]) {
        await page.evaluate((path) => document.querySelector(`.nav-menu-link[href="${path}"]`).click(), path);
        await page.waitForURL(fixture.origin + path);
      }
      const probe = await page.evaluate(() => {
        window.dispatchEvent(new Event("component-probe"));
        return window.componentProbe;
      });
      check(
        `${width} component faults preserve cached navigation and release resources`,
        probe.calls === 0 && probe.released === 3 && probe.healthy === 4,
      );

      await page.goto(fixture.origin + "/__fixture/session/admin");
      await ready(page);
      await page.goto(fixture.origin + "/productions/1");
      await ready(page);
      check(
        `${width} admin form loads its own entry`,
        (await page.locator('script[src*="credit-forms."]').count()) === 1,
      );
      check(
        `${width} notifications load for admin`,
        (await page.locator('script[src*="admin-notifications."]').count()) === 1,
      );
      check(
        `${width} unrelated import entry stays absent`,
        (await page.locator('script[src*="credit-import."]').count()) === 0,
      );
      await page.locator(".production-management-panel summary").first().click();
      await page.locator("[data-add-credit]").click();
      check(`${width} add credit row`, (await page.locator("[data-credit-rows] [data-credit-row]").count()) === 2);
      await page.locator("[data-credit-rows] [data-remove-credit]").last().click();
      check(`${width} remove credit row`, (await page.locator("[data-credit-rows] [data-credit-row]").count()) === 1);
      await page.locator("[data-member-search]").first().fill("不存在的合成队员");
      check(
        `${width} member search remains functional`,
        (await page.locator('[data-credit-rows] select[name="member_id"] option').count()) === 1,
      );
      await page.screenshot({ path: join(output, `credit-form-${width}.png`) });
    } finally {
      await context.close();
    }
  }
  const plainContext = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await plainContext.newPage();
    await page.goto(fixture.origin + "/members/1?q=" + encodeURIComponent("示例") + "&year=2024&page=2");
    await page.locator(".dossier-flower-action button").click();
    await page.waitForURL((url) => url.searchParams.get("flower") === "sent");
    const url = new URL(page.url());
    check(
      "no JavaScript flower submission retains search and page",
      url.searchParams.get("q") === "示例" &&
        url.searchParams.get("year") === "2024" &&
        url.searchParams.get("page") === "2",
    );
  } finally {
    await plainContext.close();
  }
  result.checks.push(...(await checkCreditClient(browser, output)));
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  writeFileSync(join(output, "results.json"), JSON.stringify(result, null, 2));
  await browser.close();
  await fixture.close();
}
console.log("Component and flower browser checks:", result.checks.length, "passed.");
