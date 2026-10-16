import { describe } from "./preload/discovery.js";
import { createAssetWarmer } from "./preload/assets.js";
import { PUBLIC_LANDING_PATHS } from "../shared/navigation.ts";
(() => {
  const paths = new Set(PUBLIC_LANDING_PATHS);
  const publicPage = document.body?.dataset.navigationCache === "public-v1";
  if ((!publicPage && document.body?.dataset.navigationPreload !== "public") || !window.fetch) return;
  const entries = new Map();
  const { warm, abort: abortAssets } = createAssetWarmer();
  const connection = navigator.connection;
  const limited = () =>
    navigator.onLine === false || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "");
  const canonical = (href) => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !paths.has(url.pathname) || url.search) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };
  const current = canonical(location.href);
  if (!current) return;
  const opening = window.blackboxSiteOpening;
  const version = opening?.version || document.querySelector("script[data-site-opening]")?.dataset.siteOpening;
  const storageKey = opening?.storageKey || (version && "blackbox-navigation-ready:" + version);
  const dismissalKey = opening?.dismissalKey || (version && "blackbox-navigation-dismissed:" + version);
  const alreadyPrepared = () => {
    try {
      return storageKey && sessionStorage.getItem(storageKey) === "ready";
    } catch {
      return false;
    }
  };
  let suspended = false,
    leaving = false,
    generation = 0,
    startupRunning = false,
    stopped = "",
    intentTimer,
    cancelFonts;
  const cancel = (except) => {
    generation++;
    suspended = true;
    clearTimeout(intentTimer);
    for (const [url, entry] of entries) {
      if (url !== except && !entry.ready) {
        entry.controller.abort();
        entries.delete(url);
      }
    }
  };
  const prepare = (href, foreground = false, refresh = false) => {
    const url = canonical(href);
    if (!url) return null;
    if (foreground && !startupRunning) cancel(url);
    const cached = entries.get(url);
    if (cached && !refresh && (!cached.ready || cached.expires > Date.now())) return cached.promise;
    cached?.controller.abort();
    const controller = new AbortController();
    const entry = { controller, ready: false, expires: 0 };
    entries.set(url, entry);
    const timeout = setTimeout(() => controller.abort(), 6000);
    entry.promise = (async () => {
      const response = await fetch(url, {
        // Logged-in pages discover only anonymous public resources, never private HTML.
        credentials: publicPage ? "same-origin" : "omit",
        cache: refresh ? "reload" : "default",
        signal: controller.signal,
        priority: foreground ? "high" : "low",
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      if (
        response.type === "opaqueredirect" ||
        !response.ok ||
        response.redirected ||
        response.headers.get("X-Blackbox-Navigation") !== "public-v1" ||
        !response.headers.get("Content-Type")?.includes("text/html")
      )
        throw new Error("navigation-response");
      const html = await response.text();
      if (controller.signal.aborted) throw new Error("navigation-aborted");
      if (html.length > 750000) throw new Error("navigation-size");
      const template = document.createElement("template");
      template.innerHTML = html; // Inert discovery only: never execute or replay destination HTML.
      const data = describe(template.content, url);
      entry.ready = true;
      const responseDate = Date.parse(response.headers.get("Date") || "");
      const age = Math.max(
        Number(response.headers.get("Age")) || 0,
        Number.isFinite(responseDate) ? (Date.now() - responseDate) / 1000 : 0,
      );
      entry.expires = Date.now() + Math.max(0, 15 - age) * 1000;
      return data;
    })()
      .catch((error) => {
        if (entries.get(url) === entry) entries.delete(url);
        throw error;
      })
      .finally(() => clearTimeout(timeout));
    return entry.promise;
  };
  const descriptors = (data, includeImages) => [
    ...data.styles.map((url) => ({ url, image: false })),
    ...data.scripts.map((url) => ({ url, image: false })),
    ...(includeImages ? data.images.map((url) => ({ url, image: true })) : []),
  ];
  const warmAssets = (data, includeImages = false) =>
    Promise.allSettled(
      data ? descriptors(data, includeImages && !limited()).map((asset) => warm(asset.url, asset.image)) : [],
    );
  const abortStartup = (status) => {
    if (!startupRunning || stopped) return;
    stopped = status;
    cancel();
    abortAssets();
    cancelFonts?.();
  };
  const pause = () => {
    abortStartup("skipped");
    cancel();
    abortAssets();
  };
  const blocked = () => leaving || document.hidden || limited();
  const resume = () => {
    suspended = blocked();
  };
  document.addEventListener("blackbox:navigation-start", () => {
    leaving = true;
    pause();
  });
  document.addEventListener("blackbox:navigation-cancel", () => {
    leaving = false;
    resume();
  });
  document.addEventListener("blackbox:opening-finished", (event) => {
    if (["timeout", "skipped", "partial"].includes(event.detail?.status)) abortStartup(event.detail.status);
  });
  const startup = async () => {
    if (window.blackboxCurtainArrival) return { status: "navigation", completed: 0, total: 0, failed: 0 };
    if (opening && !opening.active && ["timeout", "skipped", "partial"].includes(opening.status))
      return { status: opening.status, completed: 0, total: 0, failed: 0 };
    if (limited()) {
      opening?.finish({ status: "limited" });
      return { status: "limited", completed: 0, total: 0, failed: 0 };
    }
    if (alreadyPrepared()) return { status: "warm", completed: 0, total: 0, failed: 0 };
    try {
      if (dismissalKey && sessionStorage.getItem(dismissalKey) === "dismissed")
        return { status: "deferred", completed: 0, total: 0, failed: 0 };
    } catch {}
    startupRunning = true;
    let completed = 0,
      failed = 0,
      remainingPages = paths.size;
    const fontTask = Boolean(document.fonts?.load);
    let total = paths.size + Number(fontTask);
    const deadline = setTimeout(() => abortStartup("timeout"), 10000);
    const pages = [];
    const manifest = new Map();
    let truncated = false;
    const update = () => opening?.update({ completed, total, failed, discovering: remainingPages > 0 });
    const prepareFonts = async () => {
      let fontTimer;
      try {
        const text = ("黑匣子首页作品资料库队员鸣谢" + pages.map((page) => page.text).join("")).slice(0, 512);
        await Promise.race([
          document.fonts.load('900 32px "Blackbox Display"', text),
          new Promise((_, reject) => {
            cancelFonts = () => reject(new Error("navigation-aborted"));
            fontTimer = setTimeout(cancelFonts, 6000);
          }),
        ]);
      } finally {
        clearTimeout(fontTimer);
        cancelFonts = null;
      }
    };
    try {
      update();
      // One bounded queue owns both discovery and downloads. A slow later page
      // cannot hold back already discovered assets; at most two jobs run at once.
      await new Promise((resolve) => {
        let running = 0;
        const queue = [];
        const addPage = async (path) => {
          try {
            const page = path === location.pathname && publicPage ? describe(document, current) : await prepare(path);
            if (stopped) return;
            pages.push(page);
            const discovered = [];
            for (const asset of descriptors(page, true)) {
              if (manifest.has(asset.url)) continue;
              if (manifest.size >= 40) {
                truncated = true;
                continue;
              }
              manifest.set(asset.url, asset);
              total++;
              discovered.push(() => warm(asset.url, asset.image));
            }
            queue.unshift(...discovered);
          } finally {
            remainingPages--;
            if (!remainingPages && fontTask) queue.unshift(prepareFonts);
          }
        };
        const orderedPaths = [location.pathname, ...paths].filter(
          (path, index, all) => paths.has(path) && all.indexOf(path) === index,
        );
        for (const path of orderedPaths) queue.push(() => addPage(path));
        const pump = () => {
          if (stopped) queue.length = 0;
          while (running < 2 && queue.length) {
            const job = queue.shift();
            running++;
            Promise.resolve()
              .then(() => {
                if (!stopped) return job();
              })
              .then(
                () => completed++,
                () => failed++,
              )
              .finally(() => {
                running--;
                update();
                pump();
              });
          }
          if (!running && !queue.length) resolve();
        };
        pump();
      });
      const status = stopped || (failed || completed !== total || truncated ? "partial" : "ready");
      if (status === "ready" && storageKey) {
        try {
          sessionStorage.setItem(storageKey, "ready");
        } catch {}
      }
      opening?.finish({ status });
      return { status, completed, total, failed };
    } finally {
      clearTimeout(deadline);
      startupRunning = false;
      resume();
    }
  };
  const intent = (event) => {
    const link = event.target instanceof Element ? event.target.closest(".top a[href], .mobile-nav a[href]") : null;
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = canonical(link.href);
    if (!url || url === current || limited() || suspended || startupRunning) return;
    clearTimeout(intentTimer);
    intentTimer = setTimeout(
      async () => {
        if (blocked() || suspended || startupRunning) return;
        const pending = prepare(url, true);
        const intentGeneration = generation;
        try {
          const data = await pending;
          if (intentGeneration === generation && !blocked()) await warmAssets(data, true);
        } catch {
        } finally {
          if (intentGeneration === generation) resume();
        }
      },
      event.type === "pointerover" ? 120 : 0,
    );
  };
  document.addEventListener("pointerover", intent, { passive: true });
  document.addEventListener("pointerdown", intent, { passive: true });
  document.addEventListener("focusin", intent);
  document.addEventListener("pointerout", () => clearTimeout(intentTimer), { passive: true });
  window.addEventListener("pagehide", () => {
    leaving = true;
    pause();
  });
  window.addEventListener("pageshow", () => {
    leaving = false;
    resume();
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : resume()));
  window.addEventListener("offline", pause);
  window.addEventListener("online", resume);
  connection?.addEventListener?.("change", () => (limited() ? pause() : resume()));
  window.blackboxNavigationPrefetch = {
    prepare,
    warmAssets,
    cancel,
    resume,
    eligible: (href) => Boolean(canonical(href)),
    startupPromise: startup(),
  };
})();
