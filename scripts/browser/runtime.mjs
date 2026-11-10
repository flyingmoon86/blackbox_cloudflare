import { mkdirSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export async function launchBrowser(options = {}) {
  const configured = process.env.PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_PATH || "playwright-core";
  const specifier = isAbsolute(configured) ? pathToFileURL(configured).href : configured;
  const { chromium } = await import(specifier);
  return chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : "chrome"),
    ...options,
  });
}

export function evidenceDirectory(name, override) {
  const directory = resolve(override || process.env.EVIDENCE_DIR || `artifacts/working/${name}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

export async function waitForPageReady(page) {
  await page.waitForFunction(() => !window.blackboxCurtain?.active && !window.blackboxSiteOpening?.active, null, {
    timeout: 160000,
  });
  await page.evaluate(() => document.fonts.ready);
}

export async function waitForImage(locator) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate(async (image) => {
    await image.decode();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}
