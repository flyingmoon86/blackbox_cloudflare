import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { visibilityFixture } from "./backend/visibility-fixture.mjs";
import { context } from "./backend/harness.mjs";

// Actual Worker routes with an isolated in-memory database; no local or live user data.
const s = await visibilityFixture();
const root = resolve("public");
const dir = "docs/evidence/2026-09-20-production-visibility";
mkdirSync(dir, { recursive: true });
const image = readFileSync("public/images/elephant-mascot-360-v1.webp");
for (const key of ["public.jpg", "public-preview.jpg", "hidden.jpg", "hidden-preview.jpg"])
  await s.env.FILES.put(key, image);
s.db.exec("UPDATE site_profile SET featured_production_id=NULL,hero_photo='',page_texts='{}'");
s.env.ASSETS.fetch = async (request) => {
  const path = resolve(root, "." + new URL(request.url).pathname);
  if (!path.startsWith(root + "/") && !path.startsWith(root + "\\")) return new Response("missing", { status: 404 });
  try {
    const mime = {
      ".css": "text/css",
      ".js": "application/javascript",
      ".woff2": "font/woff2",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    return new Response(readFileSync(path), {
      headers: { "Content-Type": mime[extname(path)] || "application/octet-stream" },
    });
  } catch {
    return new Response("missing", { status: 404 });
  }
};
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await s.worker.fetch(
      new Request("http://127.0.0.1:" + server.address().port + req.url, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      }),
      s.env,
      context(),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error.message);
    res.writeHead(500).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1366, 390]) {
    s.db.exec("UPDATE production SET is_hidden=0 WHERE id=2");
    const admin = await browser.newContext({
      viewport: { width, height: 768 },
      hasTouch: width === 390,
      reducedMotion: "reduce",
    });
    await admin.addCookies(
      s.cookies[1].split("; ").map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
      }),
    );
    const page = await admin.newPage();
    const errors = [];
    const failures = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(r.status() + " " + new URL(r.url()).pathname);
    });
    const check = async (name) => {
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name);
      await page.screenshot({ path: `${dir}/${width}-${name}.png`, fullPage: true });
    };
    await page.goto(base + "/productions", { waitUntil: "networkidle" });
    await check("before-public");
    const toggle = page.locator('form[action="/admin/productions/2/visibility"] button');
    if (width === 390) {
      await toggle.scrollIntoViewIfNeeded();
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), toggle.tap()]);
    } else {
      await toggle.focus();
      await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.keyboard.press("Enter")]);
    }
    assert.equal(s.db.prepare("SELECT is_hidden FROM production WHERE id=2").get().is_hidden, 1);
    await page.locator('[name="visibility"]').selectOption("hidden");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.getByRole("button", { name: "查找", exact: true }).click(),
    ]);
    assert.equal(await page.locator(".production-card").count(), 1);
    assert.match(await page.locator(".production-visibility").innerText(), /已隐藏/);
    await check("hidden-filter");
    await page.goto(base + "/productions/2", { waitUntil: "networkidle" });
    await check("admin-detail");
    await page.goto(base + "/admin/productions/2/edit", { waitUntil: "networkidle" });
    await page.locator('input[name="is_hidden"][value="1"]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('input[name="is_hidden"][value="1"]').isChecked(), true);
    await check("edit");
    const guest = await browser.newPage({ viewport: { width, height: 768 }, javaScriptEnabled: false });
    await guest.goto(base + "/productions", { waitUntil: "networkidle" });
    assert.doesNotMatch(await guest.locator("main").innerText(), /隐藏演出|已隐藏/);
    assert.equal(await guest.locator(".production-card").count(), 1);
    await guest.screenshot({ path: `${dir}/${width}-guest.png`, fullPage: true });
    assert.equal((await guest.goto(base + "/productions/2")).status(), 404);
    await guest.close();
    const nojs = await browser.newContext({ viewport: { width, height: 768 }, javaScriptEnabled: false });
    await nojs.addCookies(await admin.cookies());
    const plain = await nojs.newPage();
    await plain.goto(base + "/productions?visibility=hidden");
    await Promise.all([
      plain.waitForNavigation({ waitUntil: "networkidle" }),
      plain.getByRole("button", { name: "取消隐藏", exact: true }).click(),
    ]);
    assert.equal(s.db.prepare("SELECT is_hidden FROM production WHERE id=2").get().is_hidden, 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    console.log(
      JSON.stringify({ width, hide: true, filter: true, unhideWithoutJS: true, overflow: false, errors, failures }),
    );
    await nojs.close();
    await admin.close();
  }
} finally {
  await browser.close();
  server.close();
  s.db.close();
}
