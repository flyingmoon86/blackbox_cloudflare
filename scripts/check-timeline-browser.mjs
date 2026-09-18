import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const directory = "docs/evidence/2026-09-18-timeline";
mkdirSync(directory, { recursive: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 768 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    await page.goto("http://127.0.0.1:8787/productions?view=timeline", { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const links = await page.locator(".timeline-link").count();
    const visited = new Set();
    for (let i = 0; i < links + 40; i++) {
      await page.keyboard.press("Tab");
      const target = await page.evaluate(() =>
        document.activeElement?.matches(".timeline-link") ? document.activeElement.getAttribute("href") : null,
      );
      if (target) visited.add(target);
    }
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      years: [...document.querySelectorAll(".timeline-year>h2")].map((x) => x.textContent),
      works: document.querySelectorAll(".timeline-link").length,
    }));
    await page.evaluate(() => {
      document.activeElement?.blur();
      scrollTo(0, 0);
    });
    await page.screenshot({ path: `${directory}/${width}.png`, fullPage: true });
    await page.screenshot({ path: `${directory}/${width}-viewport.png` });
    console.log(JSON.stringify({ width, metrics, keyboardDestinations: visited.size, errors }));
    if (metrics.overflow || !links || !visited.size || errors.length) throw Error("Timeline browser check failed");
    await page.locator(".timeline-link").first().focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/productions\/\d+/);
    await page.close();
  }
} finally {
  await browser.close();
}
