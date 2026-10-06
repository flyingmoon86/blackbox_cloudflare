// Isolated synthetic browser rehearsal: never reads or changes production records.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, extname, sep } from "node:path";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./backend/harness.mjs";
const courseRequire = createRequire(resolve("../大作业/app/package.json"));
const { serve } = courseRequire("@hono/node-server");
const { chromium } = courseRequire("playwright-core");
const out = resolve(process.argv[2] || ".wrangler/resource-picker-browser");
mkdirSync(out, { recursive: true });
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const db = createDatabase(),
  secret = "synthetic-resource-browser-secret";
db.exec(
  "INSERT INTO user(id,username,password_hash,role) VALUES(1,'admin','fixture','admin'); INSERT INTO production(id,title) VALUES(1,'舞台记忆（合成演示）'),(2,'其他作品');",
);
const add = db.prepare(
  "INSERT INTO resource(id,title,res_type,status,filename,original_name,preview_filename,production_id) VALUES(?,?,?,?,?,?,?,?)",
);
for (let id = 1; id <= 65; id++) {
  const type = id % 6 === 0 ? "script" : id % 7 === 0 ? "audio" : "photo";
  const title =
    id % 3 === 0
      ? "NR8AVjViQ1FBNU56TTJOak0wTWpJS3M0WnF6WG9GSXchlQUAcXVuZ3o".repeat(3) + id
      : "舞台记录 " + String(id).padStart(2, "0");
  add.run(
    id,
    title,
    type,
    id % 8 === 0 ? "pending" : "approved",
    "fixture.webp",
    `原始文件-${id}.webp`,
    type === "photo" ? "fixture.webp" : "",
    id === 65 ? 2 : id <= 24 ? 1 : null,
  );
}
db.exec(
  "UPDATE production SET cover_id=1 WHERE id=1; INSERT INTO announcement(title,content) VALUES('黑匣子新版更新｜浏览与资料整理优化','合成公告');",
);
const files = fakeBucket();
await files.put("fixture.webp", readFileSync("public/images/elephant-mascot-360-v1.webp"), {
  httpMetadata: { contentType: "image/webp" },
});
const assetsRoot = resolve("public");
const env = {
  DB: d1(db),
  FILES: files,
  SESSION_SECRET: secret,
  ENVIRONMENT: "development",
  TURNSTILE_ENABLED: "false",
  ASSETS: {
    fetch: async (req) => {
      const path = resolve(assetsRoot, "." + decodeURIComponent(new URL(req.url).pathname));
      if (!path.startsWith(assetsRoot + sep) || !existsSync(path)) return new Response("missing", { status: 404 });
      const type =
        {
          ".css": "text/css",
          ".js": "application/javascript",
          ".png": "image/png",
          ".webp": "image/webp",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[extname(path)] || "application/octet-stream";
      return new Response(readFileSync(path), { headers: { "Content-Type": type } });
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
    executablePath: process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await ctx.addCookies([
    {
      name: "blackbox_session",
      value: await createSession({ uid: 1, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, secret),
      url: origin,
    },
  ]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin + "/admin/productions/1/edit");
  const picker = page.locator("[data-resource-picker]");
  await picker.locator("[data-picker-tools]").waitFor();
  assert.equal(await picker.locator("[data-resource-card]:visible").count(), 12);
  assert.equal(
    await picker.locator("img[src]").count(),
    await picker.locator("[data-resource-card]:visible img").count(),
    "Only the current page gets image URLs",
  );
  const wanted = await picker.locator("input:checked").evaluateAll((inputs) => inputs.map((i) => i.value).sort());
  await picker.locator("[data-picker-next]").click();
  assert.deepEqual(
    await picker.locator("input:checked").evaluateAll((inputs) => inputs.map((i) => i.value).sort()),
    wanted,
  );
  await picker.locator("[data-picker-search]").fill("原始文件-40.webp");
  assert.equal(await picker.locator("[data-resource-card]:visible").count(), 1);
  await picker.locator('input[value="40"]').check();
  wanted.push("40");
  wanted.sort();
  await picker.locator("[data-picker-search]").fill("不存在的资料");
  await picker.locator("[data-picker-empty]").waitFor();
  await picker.locator("[data-picker-search]").press("Enter");
  assert.equal(new URL(page.url()).pathname, "/admin/productions/1/edit");
  await picker.locator("[data-picker-reset]").click();
  await picker.locator("[data-picker-selected]").click();
  assert.equal(await picker.locator("[data-picker-selected]").getAttribute("aria-pressed"), "true");
  assert.equal(await picker.locator("[data-resource-card]:visible input:not(:checked)").count(), 0);
  await picker.locator("[data-picker-reset]").click();
  await picker.locator("[data-picker-search]").fill("原始文件-1.webp");
  await picker.locator('input[value="1"]').uncheck();
  await picker.locator("[data-picker-cover-warning]").waitFor();
  await picker.locator('input[value="1"]').check();
  assert.equal(await picker.locator("[data-picker-cover-warning]").isHidden(), true);
  await picker.locator("[data-picker-reset]").click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await picker.scrollIntoViewIfNeeded();
    assert.ok(
      (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2,
      `No page overflow at ${width}`,
    );
    assert.equal(
      await picker
        .locator("[data-resource-card]:visible")
        .evaluateAll((cards) => cards.some((c) => c.scrollWidth > c.clientWidth + 2)),
      false,
    );
    await picker.locator("[data-picker-tools]").scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(out, `resource-picker-${width}.png`) });
    checks.push({ width, overflow: false });
  }
  // Save with most selected cards hidden by filtering; all must still be submitted.
  await picker.locator("[data-picker-search]").fill("原始文件-40.webp");
  const submitted = await picker.evaluate((p) => new FormData(p.closest("form")).getAll("resource_ids").sort());
  assert.deepEqual(submitted, wanted);
  await Promise.all([
    page.waitForURL(origin + "/productions/1"),
    page.getByRole("button", { name: "保存作品", exact: true }).click(),
  ]);
  assert.deepEqual(
    db
      .prepare("SELECT id FROM resource WHERE production_id=1")
      .all()
      .map((r) => String(r.id))
      .sort(),
    wanted,
  );
  assert.equal(db.prepare("SELECT status FROM resource WHERE id=40").get().status, "pending");
  await page.goto(origin + "/admin/productions/new");
  assert.equal(await picker.locator("input:checked").count(), 0);
  await picker.locator("[data-picker-type]").selectOption("script");
  assert.equal(await picker.locator('[data-resource-card]:visible:not([data-type="script"])').count(), 0);
  await picker.locator("[data-picker-select-page]").click();
  assert.ok((await picker.locator("input:checked").count()) > 0);
  await picker.locator("[data-picker-clear-page]").click();
  assert.equal(await picker.locator("input:checked").count(), 0);
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  await nojs.addCookies(await ctx.cookies());
  const fallback = await nojs.newPage();
  await fallback.goto(origin + "/admin/productions/1/edit");
  assert.equal(await fallback.locator('[name="resource_ids"]').count(), 64);
  assert.equal(await fallback.locator('[name="resource_ids"]:checked').count(), wanted.length);
  await nojs.close();
  for (const width of [1440, 768, 390, 320]) {
    const visitor = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const home = await visitor.newPage();
    home.on("pageerror", (e) => errors.push(e.message));
    await home.goto(origin + "/");
    const notice = home.locator("dialog[data-test-notice][open]");
    if (await notice.count()) await notice.getByRole("button", { name: "我已明白" }).click();
    await home.locator(".theatre-light-hint").waitFor();
    const overlaps = await home.evaluate(() => {
      const h = document.querySelector(".theatre-light-hint").getBoundingClientRect();
      return [".stage-news", ".stage-explore"].some((s) => {
        const b = document.querySelector(s).getBoundingClientRect();
        return h.left < b.right && h.right > b.left && h.top < b.bottom && h.bottom > b.top;
      });
    });
    assert.equal(overlaps, false, "Hint does not overlap home navigation");
    assert.ok((await home.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
    await home.screenshot({ path: join(out, `light-hint-${width}.png`) });
    await home.locator(".theatre-light-switch").click();
    assert.equal(await home.locator(".theatre-light-hint").isHidden(), true);
    await home.locator(".theatre-light-switch").click();
    await home.reload();
    assert.equal(await home.locator(".theatre-light-hint").isHidden(), true);
    await visitor.close();
  }
  assert.deepEqual(errors, []);
  const result = {
    checks,
    crossPageSelection: true,
    filteredSave: true,
    pendingRemainsPending: true,
    createForm: true,
    nativeFallback: true,
    lightHintOnce: true,
    errors,
  };
  writeFileSync(join(out, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
  db.close();
}
