import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createDatabase, d1, loadWorker, fakeBucket, context as requestContext } from "./backend/harness.mjs";

// Read-only, anonymous synthetic fixtures. This script never connects to D1/R2 or a deployed site.
// Usage: node scripts/check-loading-performance.mjs --label=after
// Optional: --snapshot=.wrangler/loading-baseline --profile=desktop|mobile|mobile-throttled
// Work browsing/failure checks: --mode=interactions --label=work-browse
const option = (key, fallback = "") =>
  process.argv
    .find((value) => value.startsWith(`--${key}=`))
    ?.split("=")
    .slice(1)
    .join("=") || fallback;
const label = option("label", "local");
if (!/^[a-z0-9-]+$/.test(label)) throw Error("Use a simple label");
const snapshot = option("snapshot");
const publicRoot = resolve(snapshot || ".", "public");
const evidenceRoot = resolve(option("output", `artifacts/2026-10-15/loading/${label}`));
mkdirSync(evidenceRoot, { recursive: true });
const playwrightPath = option(
  "playwright",
  "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
);
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const worker = snapshot
  ? (await import(pathToFileURL(resolve(snapshot, "worker.mjs")).href)).default
  : await loadWorker();
const db = createDatabase();
db.exec(
  "UPDATE site_profile SET troupe_name='黑匣子 · 合成预览',introduction='仅用于浏览器性能验收的合成数据',contact_email='',contact_wechat='',featured_production_id=NULL,hero_photo='',page_texts='{}',recruitment='合成招新文案',requirements='';",
);
const files = fakeBucket();
const imageBytes = readFileSync(join(publicRoot, "images/elephant-mascot-360-v1.webp"));
for (let id = 1; id <= 12; id++) {
  db.prepare(
    "INSERT INTO production(id,title,year,is_hidden,synopsis,promo,cover_id,cover_ratio) VALUES(?,?,?,0,?,?,?,'landscape')",
  ).run(id, `合成作品 ${id}`, 2027 - id, "只用于性能与交互验证的作品简介。", "合成作品预告", id);
  db.prepare(
    "INSERT INTO resource(id,production_id,status,title,res_type,filename,original_name,preview_filename,created_at) VALUES(?,?,'approved','合成公开封面','photo',?,?,?,'2026-10-15 00:00:00')",
  ).run(id, id, `synthetic-${id}.webp`, `synthetic-${id}.webp`, `synthetic-preview-${id}.webp`);
  db.prepare("INSERT INTO production_edition(production_id,name,year) VALUES(?,'合成首演',?)").run(id, 2027 - id);
  for (const name of [`synthetic-${id}.webp`, `synthetic-preview-${id}.webp`])
    await files.put(name, imageBytes, { httpMetadata: { contentType: "image/webp" } });
}
for (let id = 1; id <= 4; id++) {
  db.prepare(
    "INSERT INTO member(id,name,bio,join_year,cohort,photo,avatar_preview) VALUES(?,?,'合成成员',2026,'合成剧团',?,?)",
  ).run(id, `合成成员 ${id}`, `synthetic-${id}.webp`, `synthetic-preview-${id}.webp`);
}
// Exercise both existing card layouts in interaction checks without changing
// the performance baseline fixture.
if (option("mode") === "interactions") db.exec("UPDATE production SET feature_layout='overlay' WHERE id=5");
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};
const assetPath = (pathname) => {
  const candidate = resolve(publicRoot, "." + decodeURIComponent(pathname));
  return candidate.startsWith(publicRoot + sep) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : null;
};
let origin;
let requests = [];
let responseDelay = 0;
let coverDelay = 0;
let previewFails = false;
let fullFails = false;
const env = {
  DB: d1(db),
  FILES: files,
  ENVIRONMENT: "development",
  SESSION_SECRET: "disposable-anonymous-performance-fixture",
  ASSETS: {
    async fetch(request) {
      const pathname = new URL(request.url).pathname,
        file = assetPath(pathname);
      return file
        ? new Response(request.method === "HEAD" ? null : readFileSync(file), {
            headers: {
              "Content-Type": mime[extname(pathname)] || "application/octet-stream",
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          })
        : new Response("Not found", { status: 404 });
    },
  },
};
const server = createServer(async (incoming, outgoing) => {
  const url = new URL(incoming.url, origin);
  if (!["GET", "HEAD"].includes(incoming.method)) {
    outgoing.writeHead(405);
    outgoing.end();
    return;
  }
  const event = {
    url: url.pathname + url.search,
    startedAt: Date.now(),
    endedAt: null,
    status: null,
    bytes: 0,
    aborted: false,
  };
  requests.push(event);
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) event.aborted = true;
  });
  try {
    if (responseDelay && /^\/productions\/\d+$/.test(url.pathname))
      await new Promise((done) => setTimeout(done, responseDelay));
    if (/^\/productions\/\d+\/cover$/.test(url.pathname)) {
      const strictPreview = url.searchParams.get("previewOnly") === "1";
      const full = !url.searchParams.has("size");
      if (full && coverDelay) await new Promise((done) => setTimeout(done, coverDelay));
      if ((strictPreview && previewFails) || (full && fullFails)) {
        Object.assign(event, { status: 404, endedAt: Date.now() });
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }
    }
    if (outgoing.destroyed) return;
    const ctx = requestContext();
    const response = await worker.fetch(
      new Request(url, { method: incoming.method, headers: incoming.headers }),
      env,
      ctx,
    );
    let body = Buffer.from(await response.arrayBuffer());
    if ((response.headers.get("content-type") || "").includes("text/html"))
      body = Buffer.from(body.toString("utf8").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, ""));
    Object.assign(event, { status: response.status, bytes: body.length, endedAt: Date.now() });
    const headers = Object.fromEntries(response.headers);
    delete headers["content-length"];
    outgoing.writeHead(response.status, headers);
    outgoing.end(incoming.method === "HEAD" ? undefined : body);
    ctx.flush().catch(() => {});
  } catch (error) {
    event.error = String(error.message);
    event.status = 500;
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end("Synthetic fixture error");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
origin = `http://127.0.0.1:${server.address().port}`;
env.PUBLIC_ORIGIN = origin;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const profiles = [
  { name: "desktop", viewport: { width: 1366, height: 768 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
  {
    name: "mobile-throttled",
    viewport: { width: 390, height: 844 },
    mobile: true,
    latency: 150,
    download: 250000,
    upload: 93750,
    cpu: 4,
  },
].filter((profile) => !option("profile") || profile.name === option("profile"));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function instrument() {
  const route = location.pathname,
    documentId = crypto.randomUUID();
  const emit = (kind, detail = {}) =>
    window
      .__loadingEvidence({
        kind,
        route,
        documentId,
        time: performance.now(),
        epoch: performance.timeOrigin + performance.now(),
        ...detail,
      })
      .catch(() => {});
  // Keep state changes so a delayed PerformanceObserver callback is classified
  // using entry.startTime, not whichever curtain happens to exist at delivery.
  const phases = [{ at: 0, phase: "absent" }];
  let previousPhase = "absent",
    previousProgress = "";
  const phase = () => {
    const curtain = document.querySelector(".blackbox-curtain");
    if (!curtain) return "absent";
    if (curtain.classList.contains("is-revealing")) return "revealing";
    if (curtain.classList.contains("is-loading")) return "loading";
    if (curtain.classList.contains("is-covering")) return "covering";
    return "arriving";
  };
  const visibility = (element) => {
    if (!element) return null;
    let opacity = 1,
      hiddenAncestor = false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      opacity *= Number(style.opacity);
      if (style.display === "none" || style.visibility !== "visible" || node.hidden) hiddenAncestor = true;
    }
    const rect = element.getBoundingClientRect();
    return {
      rect: rect.toJSON(),
      opacity,
      hiddenAncestor,
      intersectsViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < innerHeight &&
        rect.left < innerWidth,
      imageReady: element instanceof HTMLImageElement ? element.complete && element.naturalWidth > 0 : null,
      imagePath: element instanceof HTMLImageElement ? new URL(element.currentSrc || element.src).pathname : null,
    };
  };
  const homeReadiness = (reason) => {
    if (route !== "/") return;
    emit("home-visibility", {
      reason,
      phase: phase(),
      headings: [...document.querySelectorAll("#welcome h1,.welcome-copy h1")].map((node) => ({
        text: node.textContent,
        ...visibility(node),
      })),
      stageBase: visibility(document.querySelector("[data-theatre-base]")),
      stageReady: document.querySelector(".theatre-stage")?.classList.contains("stage-ready"),
    });
  };
  let lastClick = 0,
    frameUntil = 0,
    signature = "",
    changed = false;
  const frame = () => {
    if (performance.now() > frameUntil) return;
    const scene = document.querySelector(".blackbox-curtain");
    const current = scene
      ? [...scene.querySelectorAll(".curtain-wing")].map((el) => getComputedStyle(el).transform).join("|")
      : "";
    if (!changed && current && signature && current !== signature) {
      changed = true;
      emit("curtain-frame-change", { afterClickMs: performance.now() - lastClick });
    }
    signature = current;
    if (!changed) requestAnimationFrame(frame);
  };
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target instanceof Element && event.target.closest("a[href]");
      if (!link) return;
      lastClick = performance.now();
      frameUntil = lastClick + 1200;
      signature = "";
      changed = false;
      emit("click", { target: new URL(link.href).pathname, input: event.pointerType || "keyboard" });
      requestAnimationFrame(frame);
    },
    true,
  );
  for (const type of [
    "blackbox:opening-finished",
    "blackbox:curtain-finished",
    "blackbox:navigation-start",
    "blackbox:navigation-cancel",
  ])
    document.addEventListener(type, (event) => {
      emit(type, { detail: event.detail });
      homeReadiness(type);
      if (type === "blackbox:curtain-finished") {
        requestAnimationFrame(() => homeReadiness("first-frame-after-curtain"));
        setTimeout(() => homeReadiness("300ms-after-curtain"), 300);
        setTimeout(() => homeReadiness("1000ms-after-curtain"), 1000);
      }
    });
  document.addEventListener(
    "animationstart",
    (event) => {
      if (event.target.closest?.(".blackbox-curtain"))
        emit("curtain-animation-start", {
          name: event.animationName,
          afterClickMs: lastClick ? performance.now() - lastClick : null,
        });
    },
    true,
  );
  const watched = new WeakSet();
  const watch = () => {
    const opening = window.blackboxSiteOpening;
    if (opening?.active) {
      const progress = {
        completed: opening.completed,
        total: opening.total,
        failed: opening.failed,
        discovering: opening.discovering,
      };
      const serialized = JSON.stringify(progress);
      if (serialized !== previousProgress) {
        previousProgress = serialized;
        emit("opening-progress", progress);
      }
    }
    const currentPhase = phase();
    if (currentPhase !== previousPhase) {
      previousPhase = currentPhase;
      phases.push({ at: performance.now(), phase: currentPhase });
      emit("curtain-phase", { phase: currentPhase });
    }
    for (const img of document.querySelectorAll(".production-hero img,.production-grid img")) {
      if (watched.has(img)) continue;
      watched.add(img);
      const report = (result) =>
        emit("cover", {
          path: new URL(img.currentSrc || img.src).pathname + new URL(img.currentSrc || img.src).search,
          result,
          naturalWidth: img.naturalWidth,
          rect: img.getBoundingClientRect().toJSON(),
          className: img.className,
        });
      img.addEventListener("load", () => report("load"));
      img.addEventListener("error", () => report("error"));
      if (img.complete) report(img.naturalWidth ? "complete" : "pending");
    }
  };
  new MutationObserver(watch).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        emit("layout-shift", {
          startTime: entry.startTime,
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          curtainPhase: phases.findLast((item) => item.at <= entry.startTime)?.phase || "absent",
          sources: entry.sources?.map((source) => ({
            node: source.node
              ? `${source.node.tagName}.${String(source.node.className || "").replace(/\s+/g, ".")}`
              : null,
            previous: source.previousRect.toJSON(),
            current: source.currentRect.toJSON(),
          })),
        });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) emit("long-task", { duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) emit("lcp", { startTime: entry.startTime, size: entry.size });
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    emit("dom-ready");
    homeReadiness("dom-ready");
  });
  window.addEventListener("load", () => emit("load"));
  window.addEventListener("pageshow", (event) => emit("pageshow", { persisted: event.persisted }));
}
async function ready(page) {
  await page.waitForFunction(
    () => document.readyState !== "loading" && !window.blackboxSiteOpening?.active && !window.blackboxCurtain?.active,
    {},
    { timeout: 45000 },
  );
  const notice = page.locator("[data-test-notice][open]");
  if (await notice.count()) await notice.getByRole("button", { name: "我已明白" }).click();
}
async function pageStats(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    scroll: scrollY,
    focused: document.activeElement?.getAttribute("href"),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    opening: window.blackboxSiteOpening
      ? {
          status: window.blackboxSiteOpening.status,
          active: window.blackboxSiteOpening.active,
          completed: window.blackboxSiteOpening.completed,
          total: window.blackboxSiteOpening.total,
        }
      : null,
    navigation: performance.getEntriesByType("navigation").map((entry) => ({
      responseStart: entry.responseStart,
      domReady: entry.domContentLoadedEventEnd,
      load: entry.loadEventEnd,
      transferSize: entry.transferSize,
    })),
    resources: performance
      .getEntriesByType("resource")
      .filter((entry) => new URL(entry.name).origin === location.origin)
      .map((entry) => ({
        path: new URL(entry.name).pathname + new URL(entry.name).search,
        start: entry.startTime,
        end: entry.responseEnd,
        transfer: entry.transferSize,
        encoded: entry.encodedBodySize,
        decoded: entry.decodedBodySize,
        initiator: entry.initiatorType,
      })),
    covers: [...document.querySelectorAll(".production-hero img,.production-grid img")].map((img) => ({
      className: img.className,
      path: new URL(img.currentSrc || img.src).pathname + new URL(img.currentSrc || img.src).search,
      complete: img.complete,
      width: img.naturalWidth,
      rect: img.getBoundingClientRect().toJSON(),
    })),
  }));
}
function cls(entries) {
  // CLS is the largest session window, not the sum across a whole document.
  let maximum = 0,
    windowValue = 0,
    windowStart = 0,
    previous = -Infinity;
  for (const entry of entries.filter((entry) => !entry.hadRecentInput).sort((a, b) => a.startTime - b.startTime)) {
    if (entry.startTime - previous >= 1000 || entry.startTime - windowStart >= 5000) {
      windowStart = entry.startTime;
      windowValue = 0;
    }
    windowValue += entry.value;
    previous = entry.startTime;
    maximum = Math.max(maximum, windowValue);
  }
  return maximum;
}
function shifts(events) {
  const entries = events.filter((event) => event.kind === "layout-shift");
  // Only fully closed first-entry loading is excluded. Reveal/cover motion can
  // expose content, so those shifts are conservatively counted as visible.
  return {
    cls: cls(entries),
    visibleCls: cls(entries.filter((entry) => entry.curtainPhase !== "loading")),
    behindLoadingShiftSum: entries
      .filter((entry) => !entry.hadRecentInput && entry.curtainPhase === "loading")
      .reduce((sum, entry) => sum + entry.value, 0),
  };
}
const summaries = [];
try {
  if (["interactions", "navigation"].includes(option("mode"))) {
    const check =
      option("mode") === "navigation"
        ? (await import("./browser/native-navigation-checks.mjs")).checkNativeNavigation
        : (await import("./browser/work-browse-checks.mjs")).checkWorkBrowsing;
    await check({
      browser,
      origin,
      evidenceRoot,
      ready,
      instrument,
      configure(options = {}) {
        responseDelay = options.htmlDelay || 0;
        coverDelay = options.coverDelay || 0;
        previewFails = Boolean(options.previewFails);
        fullFails = Boolean(options.fullFails);
        db.prepare("UPDATE production SET cover_ratio=? WHERE id=6").run(options.portrait ? "portrait" : "landscape");
      },
    });
  }
  for (const profile of ["interactions", "navigation"].includes(option("mode")) ? [] : profiles) {
    const ctx = await browser.newContext({
      viewport: profile.viewport,
      isMobile: profile.mobile,
      hasTouch: profile.mobile,
      deviceScaleFactor: 1,
    });
    const events = [],
      failures = [],
      errors = [],
      responseErrors = [];
    await ctx.exposeBinding("__loadingEvidence", (_, event) => events.push(event));
    await ctx.addInitScript(instrument);
    const page = await ctx.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) =>
      failures.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }),
    );
    page.on("response", (response) => {
      if (response.status() >= 400)
        responseErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
    });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    const transfers = [],
      networkRequests = new Map(),
      completedTransfers = [];
    cdp.on("Network.requestWillBeSent", (event) => {
      if (new URL(event.request.url).origin !== origin) return;
      networkRequests.set(event.requestId, {
        path: new URL(event.request.url).pathname + new URL(event.request.url).search,
        epoch: event.wallTime * 1000,
        type: event.type,
      });
    });
    cdp.on("Network.loadingFinished", (event) => {
      const request = networkRequests.get(event.requestId);
      if (request)
        completedTransfers.push({ ...request, endedAt: Date.now(), encodedBytesWithHeaders: event.encodedDataLength });
    });
    cdp.on("Network.dataReceived", (event) =>
      transfers.push({ epoch: Date.now(), decoded: event.dataLength, encoded: event.encodedDataLength }),
    );
    if (profile.latency) {
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: profile.latency,
        downloadThroughput: profile.download,
        uploadThroughput: profile.upload,
        connectionType: "cellular4g",
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpu });
    }
    requests = [];
    responseDelay = 0;
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ready(page);
    await page.screenshot({ path: join(evidenceRoot, `${profile.name}-home-after-curtain.png`) });
    // Fixed post-curtain window, identical before/after; catches late opacity or
    // layout changes without silently waiting for all remaining network work.
    await pause(1100);
    const first = await pageStats(page);
    await page.screenshot({ path: join(evidenceRoot, `${profile.name}-home.png`) });
    const firstRequests = requests.slice();
    const firstEvents = events.slice();
    const firstTransfers = transfers.slice();
    const firstCompletedTransfers = completedTransfers.slice();
    await page.goto(origin + "/productions", { waitUntil: "domcontentloaded", timeout: 60000 });
    await ready(page);
    const links = page.locator('.production-card h2 a[href^="/productions/"]');
    const link = links.nth(Math.min(5, (await links.count()) - 1));
    await link.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    if (profile.mobile) await pause(650);
    else {
      await link.hover();
      await pause(650);
    }
    const beforeClick = await pageStats(page);
    const box = await link.boundingBox();
    const target = await link.getAttribute("href");
    responseDelay = 1200;
    if (profile.mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(origin + target, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ready(page);
    await page.waitForFunction(
      () => [...document.querySelectorAll(".production-hero img")].every((img) => img.complete),
      {},
      { timeout: 20000 },
    );
    const detail = await pageStats(page);
    await page.screenshot({ path: join(evidenceRoot, `${profile.name}-detail.png`) });
    const click = events.findLast((event) => event.kind === "click" && event.target === target);
    const onset = events.find((event) => event.kind === "curtain-frame-change" && event.epoch > click?.epoch);
    const detailEvents = events.filter((event) => event.route === target && event.epoch > click?.epoch);
    const cover = detailEvents.find(
      (event) =>
        event.kind === "cover" &&
        event.naturalWidth > 0 &&
        /(?:work-cover-full|production-cover)/.test(event.className),
    );
    const preview = detailEvents.find(
      (event) => event.kind === "cover" && event.naturalWidth > 0 && /work-cover-preview/.test(event.className),
    );
    const nativeRequest = [...networkRequests.values()].findLast(
      (request) => request.type === "Document" && request.path === target && request.epoch > click?.epoch,
    );
    responseDelay = 0;
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 60000 });
    await ready(page);
    await pause(250);
    const back = await pageStats(page);
    const summary = {
      profile: profile.name,
      browser: browser.version(),
      snapshot: Boolean(snapshot),
      firstOpeningMs: firstEvents.find((event) => event.kind === "blackbox:opening-finished")?.time ?? null,
      firstCurtainRemovedMs: firstEvents.find((event) => event.kind === "blackbox:curtain-finished")?.time ?? null,
      firstStatus: first.opening?.status,
      firstHttpBodyBytes: firstRequests.reduce((sum, request) => sum + request.bytes, 0),
      firstRequests: firstRequests.length,
      firstTransferBytes: first.resources.reduce((sum, resource) => sum + resource.transfer, 0),
      firstReceivedBodyBytes: firstTransfers.reduce((sum, transfer) => sum + transfer.encoded, 0),
      firstCompletedResponseBytesWithHeaders: firstCompletedTransfers.reduce(
        (sum, transfer) => sum + transfer.encodedBytesWithHeaders,
        0,
      ),
      firstCls: shifts(firstEvents).cls,
      firstVisibleCls: shifts(firstEvents).visibleCls,
      firstBehindLoadingShiftSum: shifts(firstEvents).behindLoadingShiftSum,
      homeVisibility: firstEvents.filter((event) => event.kind === "home-visibility"),
      firstLongTasks: firstEvents.filter((event) => event.kind === "long-task").map((event) => event.duration),
      clickCurtainFrameMs: onset?.afterClickMs ?? null,
      clickNativeDocumentRequestMs: click && nativeRequest ? nativeRequest.epoch - click.epoch : null,
      clickCoverReadyMs: click && cover ? cover.epoch - click.epoch : null,
      clickPreviewReadyMs: click && preview ? preview.epoch - click.epoch : null,
      detailCls: shifts(detailEvents).cls,
      detailVisibleCls: shifts(detailEvents).visibleCls,
      backExpectedFocus: target,
      beforeClickScroll: beforeClick.scroll,
      backScrollDifference: back.scroll - beforeClick.scroll,
      backFocus: back.focused,
      overflow: [first, beforeClick, detail, back].some((stats) => stats.overflow),
      errors,
      responseErrors,
    };
    const record = {
      evidenceLevel: "Rendered browser automation",
      synthetic: true,
      recordedAt: new Date().toISOString(),
      label,
      profile,
      conditions: {
        localNodeWorker: true,
        syntheticImageBytes: imageBytes.length,
        nativeHtmlResponseDelayForClickMs: 1200,
        sourceFrameMetric: "computed curtain transform change at requestAnimationFrame, not physical display latency",
        postCurtainObservationMs: 1100,
        byteDefinitions: {
          firstHttpBodyBytes:
            "Fixture response body bytes prepared by server, including bodies later aborted by browser throttling; NOT actual download bytes",
          firstTransferBytes:
            "Resource Timing transferSize sum for completed subresources only, includes response headers; excludes navigation and unfinished/aborted responses",
          firstReceivedBodyBytes:
            "CDP Network.dataReceived encodedDataLength sum until sample cutoff, includes observed partial downloads; excludes HTTP headers",
          firstCompletedResponseBytesWithHeaders:
            "CDP loadingFinished encodedDataLength sum for completed responses including navigation and headers; excludes partial/aborted responses",
        },
        clsDefinition:
          "Largest 5s session with gaps under 1s, excluding recent input. Visible CLS conservatively excludes only shifts while the first-entry curtain is fully closed; it is a diagnostic, not a replacement Web Vital.",
        limitations: [
          "No physical phone",
          "No Safari or Firefox",
          "No production network or real D1/R2",
          "Single sample per profile; not a percentile or field performance claim",
        ],
      },
      summary,
      first,
      beforeClick,
      detail,
      back,
      firstRequests,
      firstTransfers,
      firstCompletedTransfers,
      requests,
      events,
      failures,
    };
    writeFileSync(join(evidenceRoot, `${profile.name}.json`), JSON.stringify(record, null, 2));
    summaries.push(summary);
    console.log(JSON.stringify(summary));
    await ctx.close();
  }
  if (!["interactions", "navigation"].includes(option("mode")))
    writeFileSync(join(evidenceRoot, "summary.json"), JSON.stringify(summaries, null, 2));
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
  db.close();
}
