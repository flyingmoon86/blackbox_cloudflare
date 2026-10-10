import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
const source = process.env.PREVIEW_ORIGIN || "http://127.0.0.1:8788";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(source).hostname));
const out = resolve(process.env.EVIDENCE_DIR || ".wrangler/navigation-editorial");
mkdirSync(out, { recursive: true });
const hits = [],
  checks = [],
  errors = [];
let delay = 0,
  fail = false,
  slowImages = false;
const proxy = createServer(async (req, res) => {
  const url = new URL(req.url, source);
  hits.push({ path: url.pathname, query: url.search, at: Date.now(), dest: req.headers["sec-fetch-dest"] });
  try {
    if (url.pathname === "/productions") {
      if (delay) await pause(delay);
      if (fail) {
        res.writeHead(503, { "Cache-Control": "no-store" });
        res.end("fixture unavailable");
        return;
      }
    }
    if (slowImages && /\/cover$|\/preview$/.test(url.pathname)) await pause(5000);
    const headers = { ...req.headers };
    delete headers.host;
    const upstream = await fetch(url, { headers, redirect: "manual" });
    const responseHeaders = Object.fromEntries(upstream.headers);
    for (const key of ["content-length", "content-encoding", "transfer-encoding", "connection"])
      delete responseHeaders[key];
    res.writeHead(upstream.status, responseHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
});
const serveDelay = process.argv.includes("--serve-delay");
await new Promise((r) => proxy.listen(serveDelay ? 8791 : 0, "127.0.0.1", r));
const base = `http://127.0.0.1:${proxy.address().port}`;
if (serveDelay) {
  delay = 3000;
  console.log(
    `Local slow-network preview ${base}/#playbill — works HTML waits 3 seconds; read-only upstream ${source}`,
  );
  await new Promise(() => {});
}
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = async (width = 1440, options = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, ...options });
  // Keep the no-JavaScript fallback genuine: injected DevTools scripts can still run.
  if (options.javaScriptEnabled !== false)
    await ctx.addInitScript(() => {
      localStorage.setItem("blackbox-stage-light-hint", "seen");
      localStorage.setItem("blackbox-stage-lights", "on");
      window.addEventListener("pagereveal", (event) => {
        window.navigationViewTransition = Boolean(event.viewTransition);
      });
    });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => {
    const error = { message: e.message, url: p.url(), width, options, completed: checks.length };
    errors.push(error);
    console.error(JSON.stringify(error));
  });
  return { ctx, p };
};
const dismiss = async (p) => {
  const dialog = p.locator("dialog[data-test-notice][open]");
  if (await dialog.count()) await dialog.getByRole("button", { name: "我已明白" }).click();
  const a = p.locator("[data-announcement-dismiss]:visible");
  if (await a.count()) await a.click();
};
const open = async (p) => {
  await p.goto(base + "/#playbill", { waitUntil: "load" });
  await dismiss(p);
};
const click = async (p, path) =>
  p.evaluate((path) => document.querySelector(`#main-navigation a[href="${path}"]`).click(), path);
const settle = async (p, path) => {
  await p.waitForURL(base + path);
  await p.waitForLoadState("domcontentloaded");
  await p.waitForTimeout(1250);
};
try {
  // Real HTTP cache: browser interception would disable it, so delays live in the local proxy.
  {
    const { ctx, p } = await context();
    await open(p);
    const first = Date.now();
    await p.waitForTimeout(900);
    assert.equal(
      hits.filter((h) => h.at >= first && h.path === "/productions").length,
      0,
      "No idle prefetch competes with initial display",
    );
    await p.waitForTimeout(2100);
    const warm = hits.filter((h) => h.path === "/productions").length;
    assert.equal(
      warm,
      1,
      JSON.stringify(
        await p.evaluate(() => ({
          ready: document.readyState,
          hidden: document.hidden,
          preload: !!window.blackboxNavigationPrefetch,
          type: navigator.connection?.effectiveType,
          save: navigator.connection?.saveData,
          cache: document.body.dataset.navigationCache,
        })),
      ),
    );
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    let cached = false;
    cdp.on("Network.responseReceived", (e) => {
      if (e.type === "Document" && e.response.url === base + "/productions")
        cached = Boolean(e.response.fromDiskCache || e.response.fromPrefetchCache);
    });
    await click(p, "/productions");
    await p.waitForURL(base + "/productions");
    await p.waitForLoadState("domcontentloaded");
    await p.waitForTimeout(150);
    await p.screenshot({ path: out + "/desktop-entering.png" });
    assert.equal(
      await p.evaluate(() => window.navigationViewTransition),
      true,
      "CSP permits cross-document view transitions",
    );
    await p.waitForTimeout(1200);
    assert.equal(
      hits.filter((h) => h.path === "/productions").length,
      warm,
      "Click reuses warmed HTML without another backend request",
    );
    assert.equal(cached, true, "Native navigation served from browser cache");
    assert.equal(await p.locator(".scene-crosslight").count(), 0);
    await p.screenshot({ path: out + "/desktop-works.png" });
    checks.push("idle prefetch follows initial load; real native navigation reuses cached document");
    await ctx.close();
  }
  for (const width of [1440, 390, 320]) {
    delay = 4800;
    const reduced = width === 320;
    const { ctx, p } = await context(width, { reducedMotion: reduced ? "reduce" : "no-preference" });
    await open(p);
    const before = await p.locator("#main-content").innerText();
    await click(p, "/productions");
    await p.waitForTimeout(850);
    assert.equal(new URL(p.url()).pathname, "/");
    assert.equal(await p.locator("#main-content").evaluate((el) => getComputedStyle(el).opacity), "1");
    assert.equal(await p.locator("#main-content").innerText(), before);
    assert.equal(await p.locator("#main-content").getAttribute("aria-busy"), "true");
    await p.waitForTimeout(2400);
    await p.locator(".scene-navigation-assist.is-slow").waitFor({ state: "visible" });
    await p.screenshot({ path: `${out}/${width}-waiting.png` });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await p.keyboard.press("Escape");
    assert.equal(await p.locator("#main-content").getAttribute("aria-busy"), null);
    assert.equal(await p.locator("#main-content").innerText(), before);
    await click(p, "/productions");
    await p.waitForTimeout(150);
    await click(p, "/members");
    await settle(p, "/members");
    assert.equal(await p.locator('#main-navigation a[aria-current="page"]').getAttribute("href"), "/members");
    assert.equal(await p.locator("[data-theatre-scene]").getAttribute("data-lights"), "on");
    delay = 0;
    await click(p, "/thanks");
    await settle(p, "/thanks");
    await p.screenshot({ path: `${out}/${width}-thanks.png` });
    await p.goBack();
    await p.waitForLoadState("domcontentloaded");
    await p.waitForTimeout(200);
    assert.equal(await p.locator("#main-content").getAttribute("aria-busy"), null);
    await p.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await p.locator(".scene-navigation-in").count(), 0);
    checks.push(
      `${width}: readable slow state, help, cancel, retarget, stage lighting, Back, reload${reduced ? ", reduced motion" : ""}`,
    );
    await ctx.close();
  }
  {
    fail = true;
    const { ctx, p } = await context();
    await open(p);
    await click(p, "/productions");
    await p.getByText("暂时无法打开页面，请重试", { exact: true }).waitFor();
    assert.equal(new URL(p.url()).pathname, "/");
    assert.equal(await p.locator("#main-content").getAttribute("aria-busy"), null);
    fail = false;
    await p.locator(".scene-navigation-assist").getByRole("button", { name: "重试", exact: true }).click();
    await settle(p, "/productions");
    checks.push("HTTP failure preserves old page; retry succeeds");
    await ctx.close();
  }
  {
    const { ctx, p } = await context();
    await open(p);
    await ctx.setOffline(true);
    await click(p, "/productions");
    await p.getByText("网络已断开，连接后可重试", { exact: true }).waitFor();
    await ctx.setOffline(false);
    await p.locator(".scene-navigation-assist").getByRole("button", { name: "重试", exact: true }).click();
    await settle(p, "/productions");
    checks.push("offline detection and recovery");
    await ctx.close();
  }
  {
    slowImages = true;
    const { ctx, p } = await context();
    await open(p);
    await click(p, "/productions");
    await settle(p, "/productions");
    assert.equal(await p.locator("h1").first().isVisible(), true);
    assert.equal(await p.locator(".scene-navigation-in").count(), 0);
    assert.ok(
      (await p.locator(".scene-image-pending").count()) > 0,
      "A delayed photo stays pending without blocking text",
    );
    await p.screenshot({ path: out + "/slow-photo.png" });
    await p.waitForTimeout(5300);
    assert.equal(await p.locator(".scene-image-pending").count(), 0);
    slowImages = false;
    checks.push("slow photos do not block text; photos reveal after actual load");
    await ctx.close();
  }
  {
    const { ctx, p } = await context();
    await p.addInitScript(() =>
      Object.defineProperty(navigator, "connection", {
        value: { saveData: true, effectiveType: "2g", addEventListener() {} },
      }),
    );
    const start = hits.length;
    await open(p);
    await p.waitForTimeout(4500);
    assert.equal(hits.slice(start).filter((h) => ["/productions", "/members", "/thanks"].includes(h.path)).length, 0);
    await click(p, "/productions");
    await settle(p, "/productions");
    checks.push("save-data suppresses speculative requests; clicked navigation still works");
    await ctx.close();
  }
  {
    const { ctx, p } = await context();
    await open(p);
    await p.waitForTimeout(3000);
    const count = hits.filter((h) => h.path === "/productions").length;
    await ctx.addCookies([{ name: "blackbox_session", value: "expired-session-fixture", url: base }]);
    await click(p, "/productions");
    await settle(p, "/productions");
    assert.equal(
      hits.filter((h) => h.path === "/productions").length,
      count + 1,
      "Cookie change must bypass anonymous cached HTML",
    );
    assert.equal(await p.locator("body").getAttribute("data-navigation-cache"), "none");
    assert.equal(await p.evaluate(() => Boolean(window.blackboxNavigationPrefetch)), false);
    const before = hits.filter((h) => h.path === "/members").length;
    await click(p, "/members");
    await settle(p, "/members");
    assert.equal(
      hits.filter((h) => h.path === "/members").length,
      before + 1,
      "Session fallback makes only the normal document request",
    );
    checks.push("browser honors Cookie cache separation; session fallback stays native without speculative fetches");
    await ctx.close();
  }
  {
    const { ctx, p } = await context(1440, { javaScriptEnabled: false });
    await p.goto(base + "/members", { waitUntil: "load" });
    await p.locator('#main-navigation > a[href="/"]').click();
    await p.waitForURL(base + "/");
    assert.equal(await p.locator("#main-content").isVisible(), true);
    checks.push("navigation and real content work without JavaScript");
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(out + "/results.json", JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
  proxy.closeAllConnections();
  await new Promise((r) => proxy.close(r));
}
