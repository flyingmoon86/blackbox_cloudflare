import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { launchBrowser, evidenceDirectory, waitForPageReady, waitForImage } from "./browser/runtime.mjs";
import { publicFixture } from "./browser/public-fixture.mjs";
import { checkMemberNavigation } from "./browser/member-navigation-checks.mjs";

const output = evidenceDirectory("public-browser");
const fixture = await publicFixture();
const browser = await launchBrowser({ args: ["--no-proxy-server"] });
const result = { checks: [], errors: [], screenshots: [], passed: false };
const check = (name, value) => {
  assert.ok(value, name);
  result.checks.push(name);
};
try {
  result.checks.push(...(await checkMemberNavigation(browser, fixture.origin)));
  for (const [device, width, height] of [
    ["desktop", 1440, 1000],
    ["mobile", 390, 844],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      ...(device === "mobile" ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => result.errors.push(e.message));
    const requests = [];
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    const go = async (path) => {
      const r = await page.goto(fixture.origin + path, { waitUntil: "domcontentloaded" });
      assert.equal(r.status(), 200);
      await waitForPageReady(page);
      check(device + path + " fits", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    };
    const shot = async (name) => {
      await page.screenshot({ path: resolve(output, device + "-" + name + ".png"), animations: "disabled" });
      result.screenshots.push(device + "-" + name + ".png");
    };
    for (const [path, name] of [
      ["/", "home"],
      ["/productions", "works"],
      ["/members", "members"],
      ["/resources", "resources"],
      ["/login", "login"],
    ]) {
      await go(path);
      await shot(name);
      if (path === "/")
        check(device + " home omits member script", !(await page.locator('script[src*="member-dossier."]').count()));
      if (path === "/members") {
        await page.locator(".member-card-link").first().click();
        await page.waitForURL(/\/members\/1\?/);
        check(
          device + " member results position saved",
          await page.evaluate(() => sessionStorage.getItem("blackbox-member-return:v1") !== null),
        );
      }
    }
    await go("/productions/1");
    await waitForImage(page.locator("[data-photo-lightbox] img").first());
    await shot("gallery");
    await page.locator("[data-photo-lightbox]").first().click();
    await page.locator("[data-photo-dialog][open]").waitFor();
    check(device + " gallery details", await page.locator("[data-photo-detail]").isVisible());
    await page.locator("[data-photo-close]").click();
    await page.waitForFunction(
      () => !document.querySelector("[data-photo-dialog]")?.open && !history.state?.photoViewer,
    );
    await go("/members/1");
    await waitForImage(page.locator(".dossier-portrait img"));
    await shot("portrait");
    await page.locator("[data-dossier-photo]").click();
    await page.locator(".dossier-photo-dialog[open]").waitFor();
    await page.locator(".dossier-photo-dialog button").click();
    await page.locator(".dossier-tabs a").first().click();
    check(device + " member tabs", await page.locator("#member-about").isVisible());
    requests.length = 0;
    await go("/3d");
    await waitForImage(page.locator(".splat-card img").first());
    await shot("three-d");
    check(
      device + " no model or engine prefetch",
      !requests.some((p) => p.endsWith("/model") || p.includes("three-d-engine")),
    );
    const opened = page.waitForRequest((r) => new URL(r.url()).pathname.endsWith("/model"));
    await page.locator("[data-splat-open]").first().click();
    await opened;
    check(device + " 3D opens on click", await page.locator(".splat-dialog").isVisible());
    await page.locator('.splat-dialog form[method="dialog"] button').click();
    check(device + " 3D closes", !(await page.locator(".splat-dialog").isVisible()));
    await go("/productions");
    if (device === "mobile") await page.locator(".menu-toggle").click();
    else await page.locator(".nav-menu-toggle").first().click();
    await shot("menu");
    await page.goto(fixture.origin + "/__fixture/session/admin");
    await waitForPageReady(page);
    await go("/admin");
    await shot("admin");
    await go("/admin/productions/1/edit");
    await shot("editor");
    await context.close();
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  writeFileSync(resolve(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  await browser.close();
  await fixture.close();
}
console.log("Public browser checks:", result.checks.length, "passed;", result.screenshots.length, "screenshots.");
