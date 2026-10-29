import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(
  "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/x.js",
);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const issues = [];
page.on("pageerror", (e) => issues.push(e.message));
for (const width of [1366, 390, 360]) {
  await page.setViewportSize({ width, height: width === 1366 ? 768 : 844 });
  await page.goto("http://127.0.0.1:8795/help");
  await page.screenshot({ path: `artifacts/handbook/web-${width}.png`, fullPage: true });
  await page.locator(".handbook-figure").first().scrollIntoViewIfNeeded();
  await page
    .locator(".handbook-figure img")
    .first()
    .evaluate((img) => img.decode());
  await page.screenshot({ path: `artifacts/handbook/illustrated-web-${width}.png` });
  const state = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    anchors: [...document.querySelectorAll(".handbook-toc a")].every((a) => document.querySelector(a.hash)),
    admin: !!document.querySelector("#admin-appendix"),
  }));
  if (state.overflow || !state.anchors || state.admin) throw Error(JSON.stringify(state));
  await page.locator('.handbook-toc a[href="#upload"]').click();
  console.log(width, JSON.stringify(state), await page.locator("#upload").boundingBox());
}
await page.goto("http://127.0.0.1:8795/help?role=admin");
if ((await page.locator("#admin-appendix").count()) !== 1) throw Error("missing admin appendix");
await page.screenshot({ path: "artifacts/handbook/admin.png", fullPage: true });
for (const href of await page
  .locator(".handbook a[href^='/']")
  .evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute("href")))])) {
  const response = await page.request.get("http://127.0.0.1:8795" + href);
  if (response.status() >= 400) throw Error(href + ": " + response.status());
}
await page.locator(".handbook-toc a").first().focus();
await page.keyboard.press("Enter");
if (!page.url().endsWith("#account")) throw Error("keyboard anchor failed");
console.log("links and keyboard anchor passed; console errors", issues);
if (issues.length) throw Error("browser errors");
await browser.close();
