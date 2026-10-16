import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// Called by check-loading-performance.mjs with its disposable real-Worker fixture.
export async function checkWorkBrowsing({ browser, origin, evidenceRoot, ready, instrument, configure }) {
  const results = [];
  const pause = (ms) => new Promise((done) => setTimeout(done, ms));
  const frameStats = (page) =>
    page.evaluate(() => {
      const frame = document.querySelector(".work-cover-frame");
      const full = frame?.querySelector(".work-cover-full");
      const preview = frame?.querySelector(".work-cover-preview");
      return {
        frame: frame?.getBoundingClientRect().toJSON(),
        previewing: frame?.classList.contains("is-previewing"),
        fullReady: Boolean(full?.complete && full.naturalWidth),
        fullOpacity: full && getComputedStyle(full).opacity,
        previewReady: Boolean(preview?.complete && preview.naturalWidth),
        previewVisibility: preview && getComputedStyle(preview).visibility,
        objectFit: full && getComputedStyle(full).objectFit,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scroll: scrollY,
        focus: document.activeElement?.getAttribute("href"),
      };
    });
  for (const mode of [
    "desktop",
    "mobile",
    "portrait-mobile",
    "reduced-motion",
    "preview-fails",
    "full-fails",
    "script-fails",
    "no-js",
  ]) {
    configure();
    const mobile = mode === "mobile" || mode === "portrait-mobile" || mode === "no-js";
    const context = await browser.newContext({
      viewport: { width: mobile ? 390 : 1366, height: mobile ? 844 : 768 },
      isMobile: mobile,
      hasTouch: mobile,
      deviceScaleFactor: 1,
      reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference",
      javaScriptEnabled: mode !== "no-js",
    });
    const events = [],
      errors = [],
      networkErrors = [],
      requests = [];
    await context.exposeBinding("__loadingEvidence", (_, event) => events.push(event));
    await context.addInitScript(instrument);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400)
        networkErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    page.on("request", (request) =>
      requests.push({ path: new URL(request.url()).pathname + new URL(request.url()).search, time: Date.now() }),
    );
    try {
      if (mode === "script-fails")
        await page.route(/\/assets\/work-browse\.[^/]+\.js$/, (route) => route.abort("failed"));
      if (mode === "no-js" || mode === "script-fails") {
        await page.goto(origin + "/productions/6", { waitUntil: "load" });
        await ready(page);
        const full = await frameStats(page);
        assert.equal(full.fullReady, true);
        assert.equal(full.fullOpacity, "1");
        assert.equal(full.overflow, false);
        await page.screenshot({ path: join(evidenceRoot, `${mode}-detail.png`) });
        await page.locator("[data-work-return]").click();
        await page.waitForURL(origin + "/productions");
        results.push({ mode, full, nativeReturn: true, errors, networkErrors });
        continue;
      }
      if (mode === "preview-fails") configure({ previewFails: true });
      const listPath = "/productions?browse-check=1";
      await page.goto(origin + listPath, { waitUntil: "domcontentloaded" });
      await ready(page);
      await pause(250);
      let mobileCard = null;
      if (mobile) {
        mobileCard = await page.locator('[data-work-card="5"]').evaluate((card) => {
          const details = card.querySelector(".production-stage-details");
          const summary = card.querySelector("p:not(.eyebrow)");
          return {
            hovering: card.matches(":hover"),
            focused: card.matches(":focus-within"),
            detailsVisibility: getComputedStyle(details).visibility,
            detailsPointerEvents: getComputedStyle(details).pointerEvents,
            summaryVisibility: summary && getComputedStyle(summary).visibility,
          };
        });
        assert.equal(mobileCard.hovering, false);
        assert.equal(mobileCard.focused, false);
        assert.equal(mobileCard.detailsVisibility, "visible");
        assert.equal(mobileCard.detailsPointerEvents, "auto");
        assert.equal(mobileCard.summaryVisibility, "visible");
        assert.equal(
          await page
            .locator('[data-work-card="6"] > p:not(.eyebrow)')
            .evaluate((node) => getComputedStyle(node).visibility),
          "visible",
        );
      }
      const automatic = requests.filter((request) => request.path.includes("previewOnly=1"));
      assert.ok(automatic.length <= 4, "automatic preview budget");
      const link = page.locator('[data-work-card="6"] h2 a');
      if (mode === "desktop") {
        for (let tabs = 0; tabs < 100; tabs++) {
          if (await link.evaluate((node) => node === document.activeElement)) break;
          await page.keyboard.press("Tab");
        }
        assert.equal(await link.evaluate((node) => node === document.activeElement), true);
      } else {
        await link.scrollIntoViewIfNeeded();
        if (!mobile) await link.hover();
      }
      await pause(350);
      if (mobile) await page.screenshot({ path: join(evidenceRoot, `${mode}-list.png`) });
      const before = await frameStats(page);
      assert.ok(before.scroll > 500, "exercise return from a scrolled list");
      configure({
        coverDelay: 2600,
        previewFails: mode === "preview-fails",
        fullFails: mode === "full-fails",
        portrait: mode === "portrait-mobile",
      });
      if (mode === "desktop") await page.keyboard.press("Enter");
      else if (mobile) await link.tap();
      else await link.click();
      await page.waitForURL(origin + "/productions/6", { waitUntil: "domcontentloaded" });
      await ready(page);
      let preview;
      if (mode === "preview-fails") {
        await page.waitForFunction(() => !document.querySelector(".work-cover-preview"));
        preview = await frameStats(page);
        assert.equal(preview.previewing, false);
        assert.equal(preview.fullOpacity, "1");
      } else {
        await page.waitForFunction(() =>
          document.querySelector(".work-cover-frame")?.classList.contains("is-previewing"),
        );
        preview = await frameStats(page);
        assert.equal(preview.fullReady, false);
        assert.equal(preview.previewReady, true);
        assert.equal(preview.previewVisibility, "visible");
      }
      await page.screenshot({ path: join(evidenceRoot, `${mode}-preview.png`) });
      await page.waitForFunction(() => document.querySelector(".work-cover-full")?.complete);
      const full = await frameStats(page);
      assert.equal(full.fullReady, mode !== "full-fails");
      assert.equal(full.previewing, mode === "full-fails");
      assert.equal(full.frame.height, preview.frame.height);
      assert.equal(full.frame.y, preview.frame.y);
      assert.equal(full.overflow, false);
      assert.equal(full.objectFit, "contain");
      if (mode === "portrait-mobile") assert.ok(full.frame.height > 500, "portrait reserves its taller frame");
      await page.screenshot({ path: join(evidenceRoot, `${mode}-full.png`) });
      configure();
      assert.equal(await page.locator("[data-work-return]").evaluate((node) => node.href), origin + listPath);
      await page.locator("[data-work-return]").click();
      await page.waitForURL(origin + listPath, { waitUntil: "domcontentloaded" });
      await ready(page);
      await pause(100);
      const returned = await frameStats(page);
      assert.ok(Math.abs(returned.scroll - before.scroll) <= 1, "explicit return position");
      assert.equal(returned.focus, "/productions/6");
      let historyReturn = null;
      if (mode === "desktop" || mode === "mobile") {
        await page.locator('[data-work-card="6"] h2 a').click();
        await page.waitForURL(origin + "/productions/6", { waitUntil: "domcontentloaded" });
        await ready(page);
        await page.goBack({ waitUntil: "domcontentloaded" });
        await ready(page);
        await pause(100);
        historyReturn = await frameStats(page);
        assert.ok(Math.abs(historyReturn.scroll - before.scroll) <= 1, "history return position");
        assert.equal(historyReturn.focus, "/productions/6");
      }
      const click = events.find((event) => event.kind === "click" && event.target === "/productions/6");
      const onset = events.find((event) => event.kind === "curtain-frame-change" && event.epoch > click?.epoch);
      const previewLoad = events.find(
        (event) => event.kind === "cover" && event.naturalWidth > 0 && /work-cover-preview/.test(event.className),
      );
      const fullLoad = events.find((event) => event.kind === "cover" && /work-cover-full/.test(event.className));
      const result = {
        mode,
        automaticPreviewRequests: automatic.length,
        mobileCard,
        before,
        preview,
        full,
        returned,
        historyReturn,
        clickCurtainFrameMs: onset?.afterClickMs ?? null,
        clickPreviewReadyMs: click && previewLoad ? previewLoad.epoch - click.epoch : null,
        clickFullCompleteMs: click && fullLoad ? fullLoad.epoch - click.epoch : null,
        errors,
        networkErrors,
      };
      assert.deepEqual(errors, []);
      if (!["preview-fails", "full-fails"].includes(mode)) assert.deepEqual(networkErrors, []);
      results.push(result);
      console.log(
        JSON.stringify({
          mode,
          result: "passed",
          clickCurtainFrameMs: result.clickCurtainFrameMs,
          clickPreviewReadyMs: result.clickPreviewReadyMs,
          clickFullCompleteMs: result.clickFullCompleteMs,
        }),
      );
    } finally {
      writeFileSync(
        join(evidenceRoot, `${mode}-events.json`),
        JSON.stringify({ events, requests, errors, networkErrors }, null, 2),
      );
      await context.close();
    }
  }
  writeFileSync(
    join(evidenceRoot, "summary.json"),
    JSON.stringify(
      {
        evidenceLevel: "Rendered browser automation",
        browser: browser.version(),
        synthetic: true,
        conditions: {
          fullCoverDelayMs: 2600,
          sameSyntheticImageForPreviewAndFull: true,
          realPhone: false,
          safari: false,
        },
        results,
      },
      null,
      2,
    ),
  );
}
