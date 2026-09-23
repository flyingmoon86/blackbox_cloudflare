import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const dir = process.env.EVIDENCE_DIR || "docs/evidence/2026-09-22-curtain-navigation";
mkdirSync(dir, { recursive: true });
await build({
  stdin: {
    contents: 'export {layout} from "./src/views.ts"; export {productionDetailPage} from "./src/views/productions.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".wrangler/curtain-navigation-view.mjs",
});
const { layout, productionDetailPage } = await import(pathToFileURL(resolve(".wrangler/curtain-navigation-view.mjs")));
const source = layout(
  "作品档案测试",
  '<h1>作品档案</h1><p>合成验收页面，不读取业务数据。</p><a id="work" href="/productions/991008">打开验收作品</a><a id="new-tab" target="_blank" href="/productions/991008">新标签打开</a>',
);
const detail = productionDetailPage(
  { id: 991008, title: "启幕加载验收", year: 2026, cover_id: 1, cover_ratio: "landscape" },
  [],
  [],
  [],
  null,
  [],
  "synthetic",
);
const cover = readFileSync("public/images/elephant-mascot-360-v1.webp");
const root = resolve("public");
let documentGate,
  themeGate,
  coverGate,
  failDocument = false;
let documents = 0,
  covers = 0;
const gate = () => {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
};
const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'";
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/source" || path === "/baseline") {
    const html =
      path === "/baseline" ? source.replace(/<script src="[^"]*curtain-boot[^"]*"[^>]*><\/script>/, "") : source;
    res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": csp }).end(html);
    return;
  }
  if (path === "/productions/991008") {
    documents++;
    await documentGate?.promise;
    res
      .writeHead(failDocument ? 404 : 200, { "Content-Type": "text/html", "Content-Security-Policy": csp })
      .end(failDocument ? layout("未找到作品", "<h1>未找到作品</h1>") : detail);
    return;
  }
  if (path === "/site/theme.css") {
    await themeGate?.promise;
    res.writeHead(200, { "Content-Type": "text/css" }).end("");
    return;
  }
  if (path === "/productions/991008/cover") {
    covers++;
    await coverGate?.promise;
    // Two real chunks, with a known length; the client must not open between them.
    res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": cover.length });
    const middle = Math.floor(cover.length / 2);
    res.write(cover.subarray(0, middle));
    setTimeout(() => res.end(cover.subarray(middle)), 400);
    return;
  }
  const file = resolve(root, "." + path);
  if (!file.startsWith(root + "/") && !file.startsWith(root + "\\")) {
    res.writeHead(403).end();
    return;
  }
  try {
    res
      .writeHead(200, {
        "Content-Type": path.endsWith(".js")
          ? "application/javascript"
          : path.endsWith(".css")
            ? "text/css"
            : "application/octet-stream",
      })
      .end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [1366, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 768 }, hasTouch: width === 390 });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const cdp = await context.newCDPSession(page);
    // Playwright frame evaluations wait for pending navigation; CDP can inspect
    // the still-visible source document while its next response is withheld.
    const inspect = async (expression) =>
      (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    const screenshot = async (name) => {
      const { data } = await cdp.send("Page.captureScreenshot");
      writeFileSync(`${dir}/${width}-${name}.png`, Buffer.from(data, "base64"));
    };
    const errors = [];
    let latency, curtainStyle;
    page.on("console", (message) => {
      if (message.text().startsWith("CURTAIN_LATENCY:")) latency = Number(message.text().split(":")[1]);
      if (message.text().startsWith("CURTAIN_STYLE:"))
        curtainStyle = JSON.parse(message.text().slice("CURTAIN_STYLE:".length));
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      document.addEventListener(
        "click",
        (e) => {
          if (e.target.closest?.("#work")) window.workClickedAt = performance.now();
        },
        true,
      );
      new MutationObserver(() => {
        if (document.querySelector("dialog.curtain-navigation[open]") && !window.closedAt) {
          window.closedAt = performance.now();
          console.log("CURTAIN_LATENCY:" + (window.closedAt - window.workClickedAt));
          const dialog = document.querySelector("dialog.curtain-navigation");
          console.log(
            "CURTAIN_STYLE:" +
              JSON.stringify({
                background: getComputedStyle(dialog).backgroundImage,
                fabric: dialog.querySelector(".curtain-cloth")?.outerHTML,
                indeterminate: !dialog.querySelector('[role="progressbar"]').hasAttribute("aria-valuenow"),
              }),
          );
        }
      }).observe(document, { subtree: true, childList: true, attributes: true });
    });
    // Before: native navigation had no source-page curtain during response delay.
    await page.goto(base + "/baseline");
    console.log(width + ": baseline ready");
    documentGate = gate();
    await inspect("document.querySelector('#work').click()");
    console.log(width + ": baseline clicked");
    await page.waitForTimeout(350);
    await screenshot("before-response");
    console.log(width + ": baseline captured");
    await cdp.send("Page.stopLoading");
    documentGate.release();
    documentGate = null;
    await page.goto(base + "/source");
    console.log(width + ": source ready");
    const initial = { documents, covers };
    await page.locator("#work").hover();
    await page.locator("#work").focus();
    await page.waitForTimeout(200);
    assert.deepEqual({ documents, covers }, initial, "No work or cover prefetch on visit, hover or focus");
    documentGate = gate();
    themeGate = gate();
    coverGate = gate();
    if (width === 390) await page.locator("#work").tap();
    else await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    assert.ok(latency < 150, `click feedback ${latency}ms`);
    assert.match(curtainStyle.background, /repeating-linear-gradient/);
    assert.equal(curtainStyle.indeterminate, true);
    // Deliberately hold HTML for three seconds: only the lightweight curtain exists.
    await page.waitForTimeout(3100);
    assert.equal(page.url(), base + "/source");
    assert.equal(covers, initial.covers);
    assert.equal(documents, initial.documents + 1, "One native detail request");
    await screenshot("waiting-document");
    const destination = page.waitForURL(base + "/productions/991008", { waitUntil: "commit" });
    documentGate.release();
    documentGate = null;
    await destination;
    await page.waitForFunction(() => document.documentElement.classList.contains("curtain-pending"));
    assert.equal(covers, initial.covers, "Cover still waits for destination runtime");
    // Boot can run while dynamic theme is still waiting (the former blocking dependency).
    await page.waitForTimeout(250);
    themeGate.release();
    themeGate = null;
    await page.locator(".work-curtain").waitFor();
    assert.equal(
      await page.locator(".work-curtain .curtain-cloth").evaluate((el) => el.outerHTML),
      curtainStyle.fabric,
      "Source and destination use identical fabric geometry and texture",
    );
    assert.equal(
      await page.evaluate(
        () => window.blackboxCurtainBoot.fabric.cloth === document.querySelector(".work-curtain .curtain-cloth"),
      ),
      true,
      "Reuse early boot cloth, do not replace it",
    );
    assert.equal(await page.locator(".work-curtain.is-opening").count(), 0);
    await page.screenshot({ path: `${dir}/${width}-waiting-cover.png` });
    coverGate.release();
    coverGate = null;
    await page.waitForFunction(() => {
      const n = Number(document.querySelector(".curtain-meter")?.getAttribute("aria-valuenow"));
      return n > 0 && n < 100;
    });
    assert.equal(await page.locator(".work-curtain.is-opening").count(), 0);
    await page.locator(".work-curtain.is-opening").waitFor();
    await page.locator(".work-curtain").waitFor({ state: "detached" });
    assert.equal(covers, initial.covers + 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${dir}/${width}-opened.png` });
    await page.goBack();
    assert.equal(await page.locator("dialog[open]").count(), 0, "Back restores an uncovered page");
    // Escape cancels the document request, and restores keyboard focus.
    documentGate = gate();
    await page.locator("#work").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), "work");
    documentGate.release();
    documentGate = null;
    await page.waitForTimeout(150);
    assert.equal(page.url(), base + "/source");
    // Error response must not leave either source or destination curtain stuck.
    failDocument = true;
    await page.locator("#work").click();
    await page.waitForURL(base + "/productions/991008");
    await page.locator("h1").filter({ hasText: "未找到作品" }).waitFor();
    assert.equal(await page.locator("dialog[open],.work-curtain,html.curtain-pending").count(), 0);
    failDocument = false;
    assert.deepEqual(errors, []);
    results.push({
      width,
      latencyMs: latency,
      htmlDelayMs: 3100,
      noPrefetch: true,
      oneDocument: true,
      oneCover: true,
      realByteProgress: true,
      back: true,
      cancel: true,
      errorRecovery: true,
      overflow: false,
      errors,
    });
    await context.close();
  }
  for (const mode of ["no-js", "reduced", "new-tab", "modified"]) {
    const context = await browser.newContext({
      javaScriptEnabled: mode !== "no-js",
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    await page.goto(base + "/source");
    if (mode === "new-tab") {
      const popupPromise = page.waitForEvent("popup");
      await page.locator("#new-tab").click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      await popup.close();
    } else if (mode === "modified") {
      const allowed = await page
        .locator("#work")
        .evaluate((el) =>
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })),
        );
      assert.equal(allowed, true);
      assert.equal(await page.locator("dialog[open]").count(), 0);
    } else {
      await page.locator("#work").click();
      await page.waitForURL(base + "/productions/991008");
      await page.locator("h1").waitFor();
      assert.equal(await page.locator("dialog[open],.work-curtain,html.curtain-pending").count(), 0);
      await page.waitForFunction(() =>
        [...document.querySelectorAll("img.production-cover")].some((i) => i.naturalWidth > 0 && !i.hidden),
      );
    }
    results.push({ mode, passed: true });
    await context.close();
  }
  writeFileSync(dir + "/metrics.json", JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results, null, 2));
} finally {
  documentGate?.release();
  themeGate?.release();
  coverGate?.release();
  await browser.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
