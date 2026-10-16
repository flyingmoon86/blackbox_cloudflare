import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export async function checkNativeNavigation({ browser, origin, evidenceRoot, ready, instrument, configure }) {
  const results = [];
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  for (const mode of ["desktop", "mobile", "reduced", "storage-blocked", "no-js"]) {
    const mobile = mode === "mobile";
    const context = await browser.newContext({
      viewport: { width: mobile ? 390 : 1366, height: mobile ? 844 : 768 },
      isMobile: mobile,
      hasTouch: mobile,
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference",
      javaScriptEnabled: mode !== "no-js",
    });
    const events = [],
      insertions = [],
      errors = [],
      timings = [];
    await context.exposeBinding("__loadingEvidence", (_, event) => events.push(event));
    await context.exposeBinding("__curtainInsertion", (_, event) => insertions.push(event));
    await context.addInitScript(instrument);
    await context.addInitScript(() => {
      const seen = new WeakSet();
      new MutationObserver((records) => {
        for (const record of records)
          for (const node of record.addedNodes) {
            if (!(node instanceof Element)) continue;
            for (const candidate of [node, ...node.querySelectorAll(".blackbox-curtain,.work-curtain")]) {
              if (!candidate.matches(".blackbox-curtain,.work-curtain") || seen.has(candidate)) continue;
              seen.add(candidate);
              window
                .__curtainInsertion({ path: location.pathname, id: candidate.id, phase: candidate.className })
                .catch(() => {});
            }
          }
      }).observe(document, { childList: true, subtree: true });
    });
    if (mode === "storage-blocked")
      await context.addInitScript(() => {
        Object.defineProperty(window, "sessionStorage", {
          get() {
            throw new DOMException("Disabled", "SecurityError");
          },
        });
      });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    page.on("pageerror", (error) => errors.push(error.message));
    const documents = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest()) documents.push({ url: request.url(), at: Date.now() });
    });
    try {
      configure();
      // Hold the late preloader briefly so first-entry loading is observable.
      if (mode !== "no-js")
        await page.route(/\/assets\/navigation-preload\.[^/]+\.js$/, async (route) => {
          await pause(600);
          await route.continue();
        });
      await page.goto(origin, { waitUntil: "commit" });
      if (mode !== "no-js") {
        await page.locator("#site-opening-curtain").waitFor({ state: "visible" });
        assert.equal(await page.locator(".curtain-label").innerText(), "正在加载黑匣子");
        assert.equal(await page.getByText("直接进入", { exact: true }).count(), 0);
        await page.screenshot({ path: join(evidenceRoot, `${mode}-first-loading.png`) });
      }
      await ready(page);
      await pause(80);
      const first = insertions.splice(0);
      if (mode !== "no-js") assert.equal(first.filter((entry) => entry.id === "site-opening-curtain").length, 1);
      events.length = 0;
      const navigate = async (locator, target, keyboard = false) => {
        if (keyboard) await locator.press("Enter");
        else {
          const rect = await locator.boundingBox();
          assert.ok(rect);
          if (mobile) await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
          else await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
        }
        await page.waitForURL(origin + target, { waitUntil: "domcontentloaded" });
        await ready(page);
      };
      const nav = (path) =>
        page
          .locator(`${mobile ? ".mobile-nav" : ".top"} a[href="${path}"]`)
          .filter({ visible: true })
          .first();
      await navigate(nav("/productions"), "/productions", !mobile);
      const work = page.locator('[data-work-card="6"] h2 a');
      await work.scrollIntoViewIfNeeded();
      const box = await work.boundingBox();
      configure({ htmlDelay: 1800, coverDelay: 1800 });
      const start = Date.now();
      if (mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await pause(300);
      assert.equal(page.url(), origin + "/productions");
      assert.deepEqual(insertions, [], "no curtain while HTML waits");
      const documentRequest = documents.findLast((request) => request.url === origin + "/productions/6");
      assert.ok(documentRequest, "native request starts while response is held");
      const screenshot = await cdp.send("Page.captureScreenshot");
      writeFileSync(join(evidenceRoot, `${mode}-waiting-native-html.png`), Buffer.from(screenshot.data, "base64"));
      await page.waitForURL(origin + "/productions/6", { waitUntil: "domcontentloaded" });
      await ready(page);
      assert.equal(await page.locator(".work-cover-full").evaluate((node) => node.complete), false);
      timings.push({ scenario: "slow-html", nativeRequestMs: documentRequest.at - start, htmlDelayMs: 1800 });
      await page.screenshot({ path: join(evidenceRoot, `${mode}-detail-without-curtain.png`) });
      await page.waitForLoadState("load");
      configure();
      await page.locator("[data-work-return]").click();
      await page.waitForURL(origin + "/productions", { waitUntil: "domcontentloaded" });
      await ready(page);
      // Rapid clicks use native browser behavior. They may restart the request;
      // the script must neither swallow them nor add a covering curtain.
      await work.scrollIntoViewIfNeeded();
      const repeated = await work.boundingBox();
      const membersTarget = await nav("/members").boundingBox();
      configure({ htmlDelay: 1800 });
      for (let index = 0; index < 3; index++) {
        if (mobile) await page.touchscreen.tap(repeated.x + repeated.width / 2, repeated.y + repeated.height / 2);
        else await page.mouse.click(repeated.x + repeated.width / 2, repeated.y + repeated.height / 2);
      }
      await pause(200);
      await cdp.send("Page.stopLoading");
      await pause(50);
      assert.equal(page.url(), origin + "/productions");
      assert.equal(await page.locator(".blackbox-curtain").count(), 0);
      configure();
      // Playwright's navigation waiter may retain a stopped provisional load.
      // Use the previously measured visible link with native pointer input.
      if (mobile)
        await page.touchscreen.tap(
          membersTarget.x + membersTarget.width / 2,
          membersTarget.y + membersTarget.height / 2,
        );
      else
        await page.mouse.click(membersTarget.x + membersTarget.width / 2, membersTarget.y + membersTarget.height / 2);
      await page.waitForURL(origin + "/members", { waitUntil: "domcontentloaded" });
      await ready(page);
      await navigate(nav("/"), "/");
      await page.goBack({ waitUntil: "domcontentloaded" });
      await ready(page);
      if (mode !== "storage-blocked") {
        await page.reload({ waitUntil: "domcontentloaded" });
        await ready(page);
      }
      assert.deepEqual(insertions, [], "source, destination, history and warm reload must stay curtain-free");
      assert.equal(events.filter((event) => event.kind === "curtain-animation-start").length, 0);
      assert.deepEqual(errors, []);
      results.push({
        mode,
        firstLoadingCount: first.length,
        internalCurtainInsertions: 0,
        timings,
        slowHtml: true,
        slowCover: true,
        rapidClickAndNativeCancel: true,
        errors,
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      writeFileSync(
        join(evidenceRoot, `${mode}-events.json`),
        JSON.stringify({ events, insertions, errors, documents }, null, 2),
      );
      await context.close();
    }
  }
  writeFileSync(
    join(evidenceRoot, "metrics.json"),
    JSON.stringify({ browser: browser.version(), evidence: "Rendered real Worker, synthetic data", results }, null, 2),
  );
}
