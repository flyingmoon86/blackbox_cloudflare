import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createDatabase, d1, fakeBucket, loadWorker, loadModule, context } from "./backend/harness.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createSession } = await loadModule("src/auth/session.ts");
const directory = process.env.EVIDENCE_DIR || "docs/evidence/2026-09-23-member-year-filter";
mkdirSync(directory, { recursive: true });
const db = createDatabase();
db.exec(
  "INSERT INTO member(id,name,cohort,join_year) VALUES(1,'未填甲','2024',NULL),(2,'未填乙','2025',NULL),(3,'有年队员','2024',2025),(4,'零年队员','2024',0),(5,'旧空值队员','2023',''); INSERT INTO user(id,username,password_hash,role) VALUES(1,'测试管理员','fixture','admin')",
);
const publicRoot = resolve("public");
const env = {
  DB: d1(db),
  FILES: fakeBucket(),
  SESSION_SECRET: "member-filter-test",
  ENVIRONMENT: "development",
  ASSETS: {
    fetch: async (request) => {
      const path = resolve(publicRoot, "." + new URL(request.url).pathname);
      if (!path.startsWith(publicRoot + "\\") && !path.startsWith(publicRoot + "/"))
        return new Response("", { status: 404 });
      try {
        return new Response(readFileSync(path), {
          headers: {
            "Content-Type":
              {
                ".css": "text/css",
                ".js": "application/javascript",
                ".woff2": "font/woff2",
                ".webp": "image/webp",
                ".svg": "image/svg+xml",
              }[extname(path)] || "application/octet-stream",
          },
        });
      } catch {
        return new Response("", { status: 404 });
      }
    },
  },
};
const worker = await loadWorker();
const server = createServer(async (req, res) => {
  try {
    const response = await worker.fetch(
      new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { headers: req.headers }),
      env,
      context(),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const metrics = [];
try {
  for (const width of [1366, 390]) {
    const contextBrowser = await browser.newContext({ viewport: { width, height: 768 }, hasTouch: width === 390 });
    await contextBrowser.addCookies([
      {
        name: "blackbox_session",
        value: await createSession(
          { uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
          env.SESSION_SECRET,
        ),
        url: base,
      },
    ]);
    const page = await contextBrowser.newPage();
    const errors = [],
      failed = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    await page.goto(base + "/members");
    await page.getByRole("combobox", { name: "入队年份" }).selectOption("missing");
    await page.getByRole("button", { name: "查找" }).click();
    assert.match(page.url(), /year=missing/);
    assert.equal(await page.locator(".member-card").count(), 3);
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${directory}/${width}-missing.png`, fullPage: true });
    await page.getByRole("textbox", { name: "搜索队员" }).fill("2024");
    await page.getByRole("button", { name: "查找" }).click();
    assert.equal(await page.locator(".member-card").count(), 1);
    await page.getByRole("textbox", { name: "搜索队员" }).fill("不存在");
    await page.getByRole("button", { name: "查找" }).click();
    assert.ok(await page.getByText("没有找到符合条件的队员。").isVisible());
    await page.screenshot({ path: `${directory}/${width}-empty.png`, fullPage: true });
    await page.getByRole("link", { name: "清除筛选" }).click();
    assert.equal(new URL(page.url()).pathname, "/members");
    assert.equal(await page.locator(".member-card").count(), 5);
    assert.equal(await page.getByRole("combobox", { name: "入队年份" }).inputValue(), "");
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    metrics.push({
      viewport: `${width}x768`,
      role: "admin",
      missing: 3,
      combined: 1,
      empty: true,
      cleared: true,
      overflow,
      errors,
      failed,
    });
    await contextBrowser.close();
  }
  writeFileSync(`${directory}/metrics.json`, JSON.stringify(metrics, null, 2) + "\n");
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
}
