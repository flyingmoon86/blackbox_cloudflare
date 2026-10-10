// Historical acceptance checks for the 2026-10-09 crosslight release only.
// The current editorial transition is covered by check-navigation-loading.mjs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";

// Run against the read-only local Worker preview. Delays affect that preview only.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.PREVIEW_ORIGIN || "http://127.0.0.1:8788";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "Use a local preview");
const out = resolve(process.env.EVIDENCE_DIR || ".wrangler/navigation-crosslight");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const checks = [],
  errors = [];
const dismiss = async (page) => {
  const notice = page.locator("dialog[data-test-notice][open]");
  if (await notice.count()) await notice.getByRole("button", { name: "我已明白" }).click();
  const announcement = page.locator("[data-announcement-dismiss]:visible");
  if (await announcement.count()) await announcement.click();
};
try {
  for (const width of [1440, 390, 320]) {
    const reduced = width === 320;
    const ctx = await browser.newContext({
      viewport: { width, height: 900 },
      hasTouch: width < 900,
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await ctx.addInitScript(() => {
      localStorage.setItem("blackbox-stage-light-hint", "seen");
      localStorage.setItem("blackbox-stage-lights", "on");
      document.addEventListener("DOMContentLoaded", () => {
        window.entryProbe = {
          incoming: document.documentElement.classList.contains("scene-navigation-in"),
          reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        };
      });
    });
    const page = await ctx.newPage();
    let waiting;
    page.on("console", (message) => {
      if (message.text().startsWith("NAV_WAIT:")) waiting = JSON.parse(message.text().slice(9));
    });
    page.on("pageerror", (e) => errors.push(e.message));
    const documents = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) documents.push(request.url());
    });
    const cdp = await ctx.newCDPSession(page);
    const inspect = async (expression) => {
      const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify({ error: result.exceptionDetails, errors }));
      return result.result.value;
    };
    const capture = async (name) => {
      const { data } = await cdp.send("Page.captureScreenshot");
      writeFileSync(`${out}/${width}-${name}.png`, Buffer.from(data, "base64"));
    };
    const click = (path, slow = false) =>
      inspect(`(() => {
      const a=document.querySelector('#main-navigation a[href="${path}"]');
      const href=a.href;
      if(${slow}) a.href='${path}?preview-wait=5000';
      setTimeout(()=>{a.click();a.href=href;},0);
    })()`);
    await page.goto(base + "/#playbill", { waitUntil: "networkidle" });
    await dismiss(page);
    assert.equal(
      await page.evaluate(() => window.entryProbe.incoming),
      false,
      "Direct entry must not replay a transition",
    );
    const content = await page.locator("#main-content").innerText();
    await capture("home");
    const before = documents.length;
    // Chrome may defer remote JS evaluation until a provisional document commits.
    // Sample and cancel in the source's own event loop while the HTTP response waits.
    await inspect(`setTimeout(() => console.log('NAV_WAIT:'+JSON.stringify({
      outgoing:document.documentElement.classList.contains('scene-navigation-out'),
      busy:document.querySelector('#main-content').getAttribute('aria-busy'),
      opacity:Number(getComputedStyle(document.querySelector('#main-content')).opacity),
      light:getComputedStyle(document.querySelector('.scene-crosslight')).display,
      oldPill:!!document.querySelector('.nav-light-status'),
      helpVisible:document.querySelector('.scene-navigation-assist').classList.contains('is-slow'),
      positioned:document.querySelector('.nav-followspot').classList.contains('is-positioned')
    })), 750);
    setTimeout(() => document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})), 1900);`);
    await click("/productions", true);
    await pause(1000);
    assert.equal(waiting?.outgoing, true, JSON.stringify({ waiting, documents, errors }));
    assert.equal(waiting.busy, "true");
    assert.equal(waiting.oldPill, false);
    assert.equal(waiting.helpVisible, false);
    assert.equal(waiting.positioned, true);
    assert.equal(waiting.opacity, reduced ? 0.6 : 0.28);
    assert.equal(waiting.light === "none", reduced);
    assert.equal(documents.length, before + 1, "One native document request, without prefetch or fetch duplicates");
    await capture("waiting");
    await pause(1100);
    assert.equal(await page.locator("#main-content").getAttribute("aria-busy"), null);
    assert.equal(await page.locator("#main-content").innerText(), content, "Cancel must preserve real content");
    assert.equal(await page.locator(".scene-navigation-out").count(), 0);
    checks.push({ width, case: "native slow request, real content retained, Escape restores original scene" });

    await inspect("setTimeout(()=>document.querySelector('#main-navigation a[href=\"/members\"]').click(),350)");
    await click("/productions", true);
    await page.waitForURL(base + "/members");
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.evaluate(() => window.entryProbe.incoming), !reduced);
    await capture("entering-members");
    await page.waitForTimeout(1250);
    assert.equal(await page.locator(".scene-navigation-in").count(), 0);
    assert.equal(await page.locator("[data-theatre-scene]").getAttribute("data-lights"), "on");
    assert.equal(await page.locator(".scene-crosslight").evaluate((el) => getComputedStyle(el).visibility), "hidden");
    checks.push({ width, case: "retarget enters correct document, entrance finishes, saved stage lighting preserved" });

    for (const path of ["/productions", "/thanks", "/"]) {
      await click(path);
      await page.waitForURL(base + path);
      await page.waitForLoadState("domcontentloaded");
      assert.equal(await page.evaluate(() => window.entryProbe.incoming), !reduced);
      await page.waitForTimeout(1200);
      await dismiss(page);
      assert.equal(await page.locator("#main-navigation a[aria-current=page]").getAttribute("href"), path);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        "No horizontal overflow",
      );
      await capture(path.slice(1) || "returned-home");
    }
    checks.push({ width, case: "real production, thanks and home content; current navigation; responsive layout" });
    await page.goBack();
    await page.waitForLoadState("domcontentloaded");
    assert.equal(await page.locator("#main-content").getAttribute("aria-busy"), null);
    assert.equal(await page.locator(".scene-navigation-out, .scene-navigation-in").count(), 0);
    await page.reload();
    assert.equal(await page.evaluate(() => window.entryProbe.incoming), false);
    checks.push({ width, case: "browser Back and reload restore a complete, undimmed page" });
    if (width < 900) {
      await page.locator(".menu-toggle").click();
      assert.equal(await page.locator("#main-navigation").evaluate((el) => el.classList.contains("is-open")), true);
      await page.locator('#main-navigation .nav-menu-link[href="/members"]').click();
      await page.waitForURL(base + "/members");
      await page.waitForTimeout(1200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      checks.push({ width, case: "mobile menu navigation" });
    }
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/results.json`, JSON.stringify({ checks, errors }, null, 2));
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}
