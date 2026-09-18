import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./backend/harness.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
const db = createDatabase();
db.exec("INSERT INTO production(id,title,year) VALUES(901,'验收用作品',2026)");
const worker = await loadWorker();
const env = { DB: d1(db), FILES: fakeBucket(), SESSION_SECRET: "fixture", ENVIRONMENT: "development" };
const browser = await chromium.launch({ channel: "chrome", headless: true });
const directory = "docs/evidence/2026-09-18-backstage";
mkdirSync(directory, { recursive: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 768 } });
    await page.route("**/productions/901", async (route) => {
      const response = await worker.fetch(new Request("http://localhost/productions/901"), env, context());
      await route.fulfill({ status: response.status, contentType: "text/html", body: await response.text() });
    });
    for (const state of ["empty", "full", "partial"]) {
      db.prepare(
        "UPDATE production_edition SET creative_keywords=?,rehearsal_place=?,duration_minutes=?,backstage_story=? WHERE production_id=901",
      ).run(
        state === "full" ? "青春、重逢" : null,
        state === "full" ? "校内排练厅" : null,
        state === "full" ? 90 : null,
        state === "empty"
          ? null
          : state === "full"
            ? "验收示例，非真实档案。\n排练时，我们把每次尝试留在这里。"
            : "长文本测试".repeat(100),
      );
      await page.goto("http://127.0.0.1:8787/productions/901", { waitUntil: "networkidle" });
      if (state === "empty") assert.equal(await page.locator(".edition-supplement").count(), 0);
      else await page.locator(".edition-supplement").scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: `${directory}/${width}-${state}.png` });
    }
    console.log(JSON.stringify({ width, empty: true, full: true, partialLongText: true, overflow: false }));
    await page.close();
  }
} finally {
  await browser.close();
  db.close();
}
