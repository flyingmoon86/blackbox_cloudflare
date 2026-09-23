import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { creditFixture } from "./backend/credit-import-fixture.mjs";
import { context } from "./backend/harness.mjs";
// Use an existing Playwright installation; do not add a production dependency.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const dir = process.env.EVIDENCE_DIR || "docs/evidence/2026-09-21-credit-import";
mkdirSync(dir, { recursive: true });
const s = await creditFixture();
const root = resolve("public");
s.env.ASSETS.fetch = async (request) => {
  const path = resolve(root, "." + new URL(request.url).pathname);
  if (!path.startsWith(root + "\\") && !path.startsWith(root + "/")) return new Response("", { status: 404 });
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
};
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await s.worker.fetch(
      new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      }),
      s.env,
      context(),
    );
    if (req.method === "POST" && /\/admin\/credit-imports\/[^/]+\/confirm$/.test(req.url))
      await new Promise((done) => setTimeout(done, 900));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const evidence = [];
try {
  for (const [width, js] of [
    [1366, true],
    [390, true],
    [390, false],
  ]) {
    const name = `${width}-${js ? "js" : "nojs"}`;
    if (process.env.BROWSER_CASE && process.env.BROWSER_CASE !== name) continue;
    const ctx = await browser.newContext({
      viewport: { width, height: 768 },
      hasTouch: width === 390,
      javaScriptEnabled: js,
      reducedMotion: "reduce",
    });
    await ctx.addCookies(
      s.cookies[1].split("; ").map((pair) => {
        const i = pair.indexOf("=");
        return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
      }),
    );
    const page = await ctx.newPage();
    const errors = [],
      failures = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) failures.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    const capture = async (phase) => {
      await page.evaluate(() => document.fonts.ready);
      if (phase !== "existing-manual-form")
        await page.evaluate(() => {
          window.scrollTo(0, 0);
          for (const el of document.querySelectorAll("main,.page-shell")) el.scrollTop = 0;
        });
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.equal(metrics.overflow, false, phase);
      await page.screenshot({ path: `${dir}/${name}-${phase}.png`, fullPage: true });
      evidence.push({ viewport: `${width}x768`, javascript: js, phase, ...metrics });
    };
    const activate = async (button) => {
      await button.scrollIntoViewIfNeeded();
      // Centre targets above the fixed mobile bottom bar, including the no-JS fallback.
      await button.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      if (width === 390) await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), button.tap()]);
      else {
        await button.focus();
        await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), page.keyboard.press("Enter")]);
      }
    };
    await page.goto(base + "/admin", { waitUntil: "networkidle" });
    assert.equal(await page.locator(".dashboard-fill h2").textContent(), "填资料");
    assert.equal(await page.locator(".dashboard-pending h2").first().textContent(), "待处理");
    const fillLinks = await page
      .locator(".dashboard-tools>a")
      .evaluateAll((links) =>
        links.map((a) => ({ name: a.querySelector("strong").textContent, href: a.getAttribute("href") })),
      );
    assert.equal(fillLinks.length, 6);
    await capture("dashboard");
    await page.goto(base + "/admin/members/new", { waitUntil: "networkidle" });
    await page.getByRole("combobox", { name: "入队年份" }).fill("2000");
    await page.getByRole("combobox", { name: "入学年级" }).fill("2000");
    assert.equal(await page.getByRole("combobox", { name: "入队年份" }).inputValue(), "2000");
    await capture("year-inputs");
    await page.goto(base + "/admin", { waitUntil: "networkidle" });
    for (const link of fillLinks.filter((a) => a.href !== "/admin/credit-imports/new")) {
      try {
        await activate(page.locator(`.dashboard-tools>a[href="${link.href}"]`));
      } catch (error) {
        await page.screenshot({ path: `${dir}/${name}-entry-failure.png`, fullPage: true });
        throw new Error(`${name}: ${link.name}: ${error.message}`);
      }
      assert.ok(await page.locator('form:not([action="/logout"])').count(), link.href);
      assert.equal(new URL(page.url()).pathname, link.href);
      await page.goto(base + "/admin", { waitUntil: "networkidle" });
    }
    await activate(page.getByRole("link", { name: /表格导入演职人员/ }));
    await capture("select-production");
    await page.getByRole("combobox", { name: "所属作品" }).selectOption("10");
    await activate(page.getByRole("button", { name: "选择版本并上传" }));
    assert.equal(new URL(page.url()).pathname, "/admin/productions/10/credits/import");
    await page.goto(base + "/productions/10", { waitUntil: "networkidle" });
    await page.locator("#manage-credits").scrollIntoViewIfNeeded();
    await capture("existing-manual-form");
    await page.getByRole("link", { name: "表格导入演职人员", exact: true }).click();
    await capture("upload");
    const csv = `*姓名,*类别,*角色或分工\n张三,演员,主角-${name}\n新队员-${name},后台与创作,舞台与灯光\n缺少角色-${name},演员,`;
    await page.getByRole("combobox", { name: /^演出版本/ }).selectOption("30");
    await page
      .getByLabel("导入文件", { exact: true })
      .setInputFiles({ name: "browser.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await activate(page.getByRole("button", { name: "上传并预览", exact: true }));
    await capture("preview");
    const reviewMetrics = await page.evaluate(() => {
      const pending = document.querySelector(".import-review-attention .import-row");
      const compact = document.querySelector(".import-row--compact");
      const rect = pending.getBoundingClientRect();
      return {
        firstPendingTop: rect.top,
        firstPendingBottom: rect.bottom,
        compactHeight: compact.getBoundingClientRect().height,
        pendingHeight: rect.height,
      };
    });
    if (width === 1366)
      assert.ok(reviewMetrics.firstPendingBottom < 768, "first pending row must fit in desktop viewport");
    assert.equal(await page.locator(".import-row--compact select").isVisible(), false);
    await page.locator(".import-row--compact summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await page.locator(".import-row--compact select").isVisible(), true);
    await page.keyboard.press("Enter");
    evidence.push({ viewport: width, javascript: js, ...reviewMetrics });
    await page.getByRole("combobox", { name: /^第 3 行处理/ }).selectOption("create");
    await page.getByRole("combobox", { name: /^第 4 行处理/ }).selectOption("skip");
    await activate(page.getByRole("button", { name: "保存选择并重新检查", exact: true }));
    await capture("ready");
    await page.getByRole("checkbox").check();
    if (js) {
      const button = page.getByRole("button", { name: "确认入库", exact: true });
      const navigation = page.waitForNavigation({ waitUntil: "networkidle" });
      if (width === 390) await button.tap();
      else {
        await button.focus();
        await page.keyboard.press("Enter");
      }
      await page.locator(".import-commit-progress").waitFor({ state: "visible" });
      assert.equal(await page.locator(".import-commit-progress progress").getAttribute("value"), null);
      const progressPosition = await page.locator(".import-commit-progress").evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: innerHeight };
      });
      assert.ok(
        progressPosition.top >= 0 && progressPosition.bottom <= progressPosition.height - (width === 390 ? 64 : 0),
      );
      await capture("committing");
      await navigation;
    } else await activate(page.getByRole("button", { name: "确认入库", exact: true }));
    assert.ok(await page.getByText("导入完成。重复确认不会再次创建记录。", { exact: true }).isVisible());
    await capture("committed");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载错误与跳过行报告" }).click();
    const download = await downloadPromise;
    assert.equal(await download.failure(), null);
    await page.getByText("撤销本批导入", { exact: true }).click();
    await page.getByRole("checkbox").check();
    await activate(page.getByRole("button", { name: "撤销导入", exact: true }));
    await capture("rolled-back");
    assert.deepEqual(errors, []);
    assert.deepEqual(failures, []);
    evidence.push({
      viewport: width,
      javascript: js,
      keyboard: width === 1366,
      touch: width === 390,
      reducedMotion: true,
      errors,
      failures,
    });
    await ctx.close();
  }
  writeFileSync(`${dir}/metrics.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ checks: evidence.length, overflow: false, errors: 0, failures: 0, directory: dir }));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  s.db.close();
}
