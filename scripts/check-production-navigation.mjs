// Read-only anonymous production acceptance; never submits forms or uses accounts.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ||
      "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  ).href
);
const origin = "https://npublackbox.online";
const output = resolve(process.argv[2] || "artifacts/working/2026-10-30-navigation-release");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const profile of [
    { name: "desktop", viewport: { width: 1366, height: 768 } },
    { name: "mobile", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  ]) {
    const context = await browser.newContext(profile);
    const page = await context.newPage();
    const requests = [],
      errors = [],
      failures = [];
    page.on("request", (request) => {
      if (/^https?:/.test(request.url()))
        requests.push({
          path: new URL(request.url()).pathname,
          type: request.resourceType(),
          purpose: request.headers()["sec-purpose"] || request.headers().purpose || "",
        });
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) =>
      failures.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }),
    );
    await page.addInitScript(() => {
      window.__commits = [];
      document.addEventListener("blackbox:page-changed", (event) => window.__commits.push(event.detail));
    });
    const started = Date.now();
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.blackboxNavigation?.startupPromise, { timeout: 10000 });
    const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
    const preparationMs = Date.now() - started;
    await page.waitForSelector(".blackbox-curtain", { state: "detached", timeout: 10000 });
    if (await page.locator(".test-notice[open]").count()) await page.locator(".test-notice button").click();
    await page.screenshot({ path: `${output}/${profile.name}-home.png`, animations: "disabled" });
    const switches = [];
    if (ready.status === "ready") {
      await page.waitForTimeout(500);
      for (const offline of [false, true]) {
        await context.setOffline(offline);
        const baseline = requests.length;
        const visits = [];
        for (const path of ["/productions", "/members", "/resources", "/thanks", "/help", "/announcements", "/"]) {
          if (path === "/productions") {
            const link = page.locator(
              profile.hasTouch
                ? '.mobile-nav a[href="/productions"]'
                : '#main-navigation .nav-menu-link[href="/productions"]',
            );
            if (profile.hasTouch) await link.tap();
            else await link.click();
          } else {
            await page.evaluate((path) => {
              let link = [...document.querySelectorAll("a[href]")].find((a) => a.getAttribute("href") === path);
              if (!link) {
                link = document.createElement("a");
                link.href = path;
                document.querySelector("main").append(link);
              }
              link.click();
            }, path);
          }
          await page.waitForURL(origin + path);
          visits.push(
            await page.evaluate(() => ({
              path: location.pathname,
              overflow: document.documentElement.scrollWidth > innerWidth + 1,
              curtain: !!document.querySelector(".blackbox-curtain"),
              brokenImages: [...document.querySelectorAll("main img[src]")].filter(
                (img) => !img.complete || !img.naturalWidth,
              ).length,
            })),
          );
          if (offline && path === "/productions")
            await page.screenshot({
              path: `${output}/${profile.name}-productions-offline.png`,
              animations: "disabled",
            });
        }
        await page.waitForTimeout(500);
        switches.push({ offline, requests: requests.slice(baseline), visits });
      }
    }
    const result = {
      profile: profile.name,
      origin,
      identity: "anonymous",
      ready,
      preparationMs,
      switches,
      commits: await page.evaluate(() => window.__commits),
      errors,
      failures,
    };
    results.push(result);
    writeFileSync(`${output}/production-navigation.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ profile: profile.name, ready, preparationMs, switches, errors, failures }));
    await context.close();
  }
} finally {
  await browser.close();
}
if (
  results.some(
    (r) =>
      r.ready.status !== "ready" ||
      r.errors.length ||
      r.switches.some((s) => s.requests.length || s.visits.some((v) => v.overflow || v.curtain || v.brokenImages)),
  )
)
  process.exitCode = 1;
