// Synthetic two-act browser rehearsal; no production credentials or writes.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { createDatabase, d1, loadWorker, fakeBucket, context } from "./backend/harness.mjs";
const require = createRequire(resolve("../大作业/app/package.json"));
const { serve } = require("@hono/node-server"),
  { chromium } = require("playwright-core");
const out = resolve(".wrangler/thanks-browser");
mkdirSync(out, { recursive: true });
const db = createDatabase(),
  worker = await loadWorker();
const dedication =
  "谢谢每一位让这座小小剧场亮起来的人。\n\n从第一张剧照、第一份剧本，到为页面提出建议的每一位伙伴，你们留下的认真和热爱，让散落的记忆有了归处。\n\n感谢在台前与幕后相遇的朋友，感谢每一次排练结束后的整理、补充和分享。愿我们一起记住那些灯光亮起的瞬间，也记住为它付出的每一个人。\n\n故事还会继续。下一次开场，我们剧场见。";
db.prepare("UPDATE site_profile SET troupe_name='黑匣子话剧队',page_texts=? WHERE id=1").run(
  JSON.stringify({ special_thanks: dedication }),
);
const insert = db.prepare(
  "INSERT INTO site_contributor(identity_key,display_name,public_consent,revoked_at) VALUES(?,?,?,?)",
);
for (let i = 1; i <= 27; i++)
  insert.run(
    "fixture:" + i,
    "合成贡献者 " + String(i).padStart(2, "0"),
    i === 26 ? 0 : 1,
    i === 27 ? "2026-10-05" : null,
  );
const root = resolve("public");
const env = {
  DB: d1(db),
  FILES: fakeBucket(),
  SESSION_SECRET: "thanks-browser-fixture",
  ENVIRONMENT: "development",
  ASSETS: {
    fetch: async (request) => {
      const path = resolve(root, "." + decodeURIComponent(new URL(request.url).pathname));
      if (!path.startsWith(root + sep) || !existsSync(path)) return new Response("missing", { status: 404 });
      return new Response(readFileSync(path), {
        headers: {
          "Content-Type":
            {
              ".css": "text/css",
              ".js": "application/javascript",
              ".png": "image/png",
              ".webp": "image/webp",
              ".woff2": "font/woff2",
            }[extname(path)] || "application/octet-stream",
        },
      });
    },
  },
};
const server = serve({ hostname: "127.0.0.1", port: 0, fetch: (r) => worker.fetch(r, env, context()) });
if (!server.listening) await once(server, "listening");
const origin = "http://127.0.0.1:" + server.address().port;
let browser;
const checks = [],
  errors = [];
try {
  browser = await chromium.launch({
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  for (const width of [1440, 390, 320]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      hasTouch: width < 901,
    });
    await ctx.addInitScript(() => localStorage.setItem("blackbox-stage-light-hint", "seen"));
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/thanks");
    const stage = page.locator(".thanks-stage"),
      first = page.locator("#dedication"),
      second = page.locator("#contributors");
    await page.waitForFunction(() => document.querySelector(".thanks-stage")?.classList.contains("stage-ready"));
    assert.equal(await first.isVisible(), true);
    assert.equal(await second.isVisible(), false);
    assert.equal(await page.locator("[data-theatre-scene]").count(), 1);
    assert.equal(await page.locator(".thanks-letter").textContent(), dedication);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
    await page.screenshot({ path: join(out, `dedication-${width}.png`) });
    await first.evaluate((el) => (el.scrollTop = el.scrollHeight));
    if (width > 900) {
      await first.hover();
      await page.mouse.wheel(0, 220);
    } else {
      const client = await ctx.newCDPSession(page);
      await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 100, y: 600 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 100, y: 380 }] });
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await client.detach();
    }
    await second.waitFor();
    assert.equal(await page.locator(".top").evaluate((el) => el.getBoundingClientRect().top), 0);
    assert.equal(await first.isVisible(), false);
    assert.equal(await page.locator(".thanks-person").count(), 25);
    assert.equal(await page.locator(".thanks-person:visible").count(), 12);
    assert.doesNotMatch(await second.textContent(), /合成贡献者 2[67]/);
    await page.screenshot({ path: join(out, `contributors-${width}.png`) });
    const next = second.getByRole("button", { name: "下一页", exact: true });
    await next.click();
    await next.click();
    assert.equal(await page.locator(".thanks-person:visible").count(), 1);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
    await second.getByRole("link", { name: "回到特别致谢 ↑" }).click();
    await first.waitFor();
    await page.locator(".thanks-next").click();
    await second.waitFor();
    await page.reload();
    await second.waitFor();
    assert.equal(await first.isHidden(), true);
    await page.locator(".theatre-light-switch").click();
    assert.equal(await stage.getAttribute("data-lights"), "on");
    // Long dedication must scroll within act one before a gesture may leave it.
    db.prepare("UPDATE site_profile SET page_texts=? WHERE id=1").run(
      JSON.stringify({ special_thanks: dedication.repeat(12) }),
    );
    await page.goto(origin + "/thanks");
    await first.waitFor();
    await first.hover();
    await page.mouse.wheel(0, 180);
    await page.waitForFunction(() => document.querySelector("#dedication").scrollTop > 0);
    assert.equal(await first.isVisible(), true);
    assert.equal(await second.isHidden(), true);
    await first.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.locator(".thanks-next").click();
    await second.waitFor();
    db.prepare("UPDATE site_profile SET page_texts=? WHERE id=1").run(JSON.stringify({ special_thanks: dedication }));
    checks.push({
      width,
      scrollAndSwipe: true,
      anchorAndReload: true,
      allPublicContributorsReachable: true,
      longDedicationScrollable: true,
      overflow: false,
    });
    await ctx.close();
  }
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 900 } });
  const fallback = await nojs.newPage();
  await fallback.goto(origin + "/thanks");
  assert.equal(await fallback.locator("#dedication").isVisible(), true);
  assert.equal(await fallback.locator("#contributors").isVisible(), true);
  assert.equal(await fallback.locator(".thanks-person:visible").count(), 25);
  await nojs.close();
  db.prepare("UPDATE site_profile SET page_texts='{}' WHERE id=1").run();
  db.exec("DELETE FROM site_contributor");
  const page = await browser.newPage();
  await page.goto(origin + "/thanks");
  await page.locator(".thanks-next").click();
  await page.locator(".thanks-empty").waitFor();
  await page.close();
  assert.deepEqual(errors, []);
  const result = { checks, nativeFallback: true, emptyStates: true, errors };
  writeFileSync(join(out, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  db.close();
}
