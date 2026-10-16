// Generated from src/client/navigation-preload.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/preload/discovery.js
  var sameOrigin = (value, base) => {
    if (!value) return null;
    try {
      const url = new URL(value, base);
      return url.origin === location.origin ? url.href : null;
    } catch {
      return null;
    }
  };
  var allowedImage = (href) => {
    const url = new URL(href);
    return /^\/assets\/[^/]+\.(?:png|jpe?g|webp|avif)$/.test(url.pathname) || /^\/site\/stage-image\/(?:home|productions|members|thanks)\/(?:unlit|light)$/.test(url.pathname) || /^\/productions\/\d+\/cover$/.test(url.pathname) && url.searchParams.get("size") === "preview" || /^\/members\/\d+\/avatar$/.test(url.pathname) && !url.search || /^\/resources\/\d+\/preview$/.test(url.pathname) || /^\/site\/(?:featured-cover|poster)$/.test(url.pathname);
  };
  var imageSource = (node, base) => {
    const picture = node.parentElement?.tagName === "PICTURE" ? node.parentElement : null;
    const source = picture && [...picture.querySelectorAll("source[media][srcset]")].find(
      (item) => matchMedia(item.getAttribute("media")).matches
    );
    const candidate = source?.getAttribute("srcset")?.trim();
    const selected = candidate && !/[\s,]/.test(candidate) ? candidate : node.currentSrc || node.getAttribute("src");
    return sameOrigin(selected, base);
  };
  var describe = (root, url) => {
    const present = new Set(
      [...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map((node) => node.href || node.src)
    );
    const styles = [...root.querySelectorAll('link[rel="stylesheet"][href]')].map((node) => sameOrigin(node.getAttribute("href"), url)).filter((href) => href && new URL(href).pathname.endsWith(".css") && !present.has(href));
    const scripts = [...root.querySelectorAll("script[src]")].map((node) => sameOrigin(node.getAttribute("src"), url)).filter((href) => href && /^\/assets\/[^/]+\.js$/.test(new URL(href).pathname) && !present.has(href));
    const imageNodes = [
      ...root.querySelectorAll("img[data-theatre-base],img[data-theatre-light]"),
      ...[
        ...root.querySelectorAll(".production-stage-image,.production-cover,.member-card-media,.resource-card img")
      ].slice(0, 4)
    ];
    if (new URL(url).pathname === "/") {
      imageNodes.push(...[...root.querySelectorAll(".recommendation-still")].slice(0, 3));
      imageNodes.push(...[...root.querySelectorAll(".playbill-art img")].slice(0, 1));
    }
    const images = imageNodes.map((node) => imageSource(node, url)).filter((href) => href && allowedImage(href));
    const text = [...root.querySelectorAll("h1,h2,.playbill-recommendation strong")].map((node) => node.textContent).join("").slice(0, 256);
    return {
      styles: [...new Set(styles)].slice(0, 8),
      scripts: [...new Set(scripts)].slice(0, 8),
      images: [...new Set(images)].slice(0, 10),
      text
    };
  };

  // src/client/preload/assets.js
  function createAssetWarmer() {
    const assets = /* @__PURE__ */ new Map();
    const warm = (url, image = false) => {
      if (assets.has(url)) return assets.get(url).promise;
      const controller = new AbortController();
      const entry = { controller, ready: false };
      assets.set(url, entry);
      const timeout = setTimeout(() => controller.abort(), 6e3);
      const work = image ? new Promise((resolve, reject) => {
        const existing = [...document.querySelectorAll("img[src]")].find(
          (node) => imageSource(node, location.href) === url
        );
        const photo = existing || new Image();
        let settled = false;
        const done = (error) => {
          if (settled) return;
          settled = true;
          photo.removeEventListener("load", loaded);
          photo.removeEventListener("error", failed);
          controller.signal.removeEventListener("abort", aborted);
          if (error) reject(error);
          else resolve();
        };
        const loaded = () => {
          if (!photo.naturalWidth) return failed();
          if (typeof photo.decode === "function") photo.decode().then(() => done(), done);
          else done();
        };
        const failed = () => done(new Error("navigation-image"));
        const aborted = () => {
          if (!existing) photo.removeAttribute("src");
          done(new Error("navigation-aborted"));
        };
        photo.addEventListener("load", loaded, { once: true });
        photo.addEventListener("error", failed, { once: true });
        controller.signal.addEventListener("abort", aborted, { once: true });
        photo.loading = "eager";
        if (!existing) {
          photo.fetchPriority = "low";
          photo.src = url;
        }
        if (photo.complete) (photo.naturalWidth ? loaded : failed)();
      }) : fetch(url, { priority: "low", signal: controller.signal }).then((response) => {
        if (!response.ok || response.redirected) throw new Error("navigation-asset");
        return response.arrayBuffer();
      }).then(() => {
      });
      entry.promise = work.then(() => {
        entry.ready = true;
      }).catch((error) => {
        if (assets.get(url) === entry) assets.delete(url);
        throw error;
      }).finally(() => clearTimeout(timeout));
      return entry.promise;
    };
    const abort = () => {
      for (const [url, entry] of assets) {
        if (!entry.ready) {
          assets.delete(url);
          entry.controller.abort();
        }
      }
    };
    return { warm, abort };
  }

  // src/shared/navigation.ts
  var PUBLIC_LANDING_PATHS = ["/", "/productions", "/resources", "/members", "/thanks"];

  // src/client/navigation-preload.js
  (() => {
    const paths = new Set(PUBLIC_LANDING_PATHS);
    const publicPage = document.body?.dataset.navigationCache === "public-v1";
    if (!publicPage && document.body?.dataset.navigationPreload !== "public" || !window.fetch) return;
    const entries = /* @__PURE__ */ new Map();
    const { warm, abort: abortAssets } = createAssetWarmer();
    const connection = navigator.connection;
    const limited = () => navigator.onLine === false || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "");
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
    const storageKey = opening?.storageKey || version && "blackbox-navigation-ready:" + version;
    const dismissalKey = opening?.dismissalKey || version && "blackbox-navigation-dismissed:" + version;
    const alreadyPrepared = () => {
      try {
        return storageKey && sessionStorage.getItem(storageKey) === "ready";
      } catch {
        return false;
      }
    };
    let suspended = false, leaving = false, generation = 0, startupRunning = false, stopped = "", intentTimer, cancelFonts;
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
      const timeout = setTimeout(() => controller.abort(), 6e3);
      entry.promise = (async () => {
        const response = await fetch(url, {
          // Logged-in pages discover only anonymous public resources, never private HTML.
          credentials: publicPage ? "same-origin" : "omit",
          cache: refresh ? "reload" : "default",
          signal: controller.signal,
          priority: foreground ? "high" : "low",
          headers: { Accept: "text/html" },
          redirect: "manual"
        });
        if (response.type === "opaqueredirect" || !response.ok || response.redirected || response.headers.get("X-Blackbox-Navigation") !== "public-v1" || !response.headers.get("Content-Type")?.includes("text/html"))
          throw new Error("navigation-response");
        const html = await response.text();
        if (controller.signal.aborted) throw new Error("navigation-aborted");
        if (html.length > 75e4) throw new Error("navigation-size");
        const template = document.createElement("template");
        template.innerHTML = html;
        const data = describe(template.content, url);
        entry.ready = true;
        const responseDate = Date.parse(response.headers.get("Date") || "");
        const age = Math.max(
          Number(response.headers.get("Age")) || 0,
          Number.isFinite(responseDate) ? (Date.now() - responseDate) / 1e3 : 0
        );
        entry.expires = Date.now() + Math.max(0, 15 - age) * 1e3;
        return data;
      })().catch((error) => {
        if (entries.get(url) === entry) entries.delete(url);
        throw error;
      }).finally(() => clearTimeout(timeout));
      return entry.promise;
    };
    const descriptors = (data, includeImages) => [
      ...data.styles.map((url) => ({ url, image: false })),
      ...data.scripts.map((url) => ({ url, image: false })),
      ...includeImages ? data.images.map((url) => ({ url, image: true })) : []
    ];
    const warmAssets = (data, includeImages = false) => Promise.allSettled(
      data ? descriptors(data, includeImages && !limited()).map((asset) => warm(asset.url, asset.image)) : []
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
      } catch {
      }
      startupRunning = true;
      let completed = 0, failed = 0, remainingPages = paths.size;
      const fontTask = Boolean(document.fonts?.load);
      let total = paths.size + Number(fontTask);
      const deadline = setTimeout(() => abortStartup("timeout"), 1e4);
      const pages = [];
      const manifest = /* @__PURE__ */ new Map();
      let truncated = false;
      const update = () => opening?.update({ completed, total, failed, discovering: remainingPages > 0 });
      const prepareFonts = async () => {
        let fontTimer;
        try {
          const text = ("\u9ED1\u5323\u5B50\u9996\u9875\u4F5C\u54C1\u8D44\u6599\u5E93\u961F\u5458\u9E23\u8C22" + pages.map((page) => page.text).join("")).slice(0, 512);
          await Promise.race([
            document.fonts.load('900 32px "Blackbox Display"', text),
            new Promise((_, reject) => {
              cancelFonts = () => reject(new Error("navigation-aborted"));
              fontTimer = setTimeout(cancelFonts, 6e3);
            })
          ]);
        } finally {
          clearTimeout(fontTimer);
          cancelFonts = null;
        }
      };
      try {
        update();
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
            (path, index, all) => paths.has(path) && all.indexOf(path) === index
          );
          for (const path of orderedPaths) queue.push(() => addPage(path));
          const pump = () => {
            if (stopped) queue.length = 0;
            while (running < 2 && queue.length) {
              const job = queue.shift();
              running++;
              Promise.resolve().then(() => {
                if (!stopped) return job();
              }).then(
                () => completed++,
                () => failed++
              ).finally(() => {
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
          } catch {
          }
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
      if (!link || link.target && link.target !== "_self" || link.hasAttribute("download")) return;
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
        event.type === "pointerover" ? 120 : 0
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
    document.addEventListener("visibilitychange", () => document.hidden ? pause() : resume());
    window.addEventListener("offline", pause);
    window.addEventListener("online", resume);
    connection?.addEventListener?.("change", () => limited() ? pause() : resume());
    window.blackboxNavigationPrefetch = {
      prepare,
      warmAssets,
      cancel,
      resume,
      eligible: (href) => Boolean(canonical(href)),
      startupPromise: startup()
    };
  })();
})();
