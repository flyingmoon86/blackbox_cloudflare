// Generated from src/client/navigation-preload.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/shared/navigation.ts
  var PUBLIC_LANDING_PATHS = [
    "/",
    "/productions",
    "/resources",
    "/members",
    "/thanks",
    "/help",
    "/announcements"
  ];

  // src/client/navigation/image-source.js
  var sameOrigin = (value, base) => {
    if (!value) return null;
    try {
      const url = new URL(value, base);
      return url.origin === location.origin ? url.href : null;
    } catch {
      return null;
    }
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

  // src/client/navigation/assets.js
  function publicImage(href) {
    const url = new URL(href, location.href);
    return url.origin === location.origin && (/^\/assets\/[^/]+\.[a-f0-9]{16}\.(?:png|jpe?g|webp|avif|svg)$/.test(url.pathname) || /^\/site\/stage-image\/(?:home|productions|members|thanks)\/(?:unlit|light)$/.test(url.pathname) || /^\/site\/(?:featured-cover|poster|mascot|hero|background)$/.test(url.pathname) || /^\/productions\/\d+\/cover$/.test(url.pathname) && url.searchParams.get("size") === "preview" || /^\/members\/\d+\/avatar$/.test(url.pathname) && !url.search || /^\/resources\/\d+\/preview$/.test(url.pathname));
  }
  function createNavigationAssets(signal) {
    const pictures = /* @__PURE__ */ new Map();
    const styles = /* @__PURE__ */ new Map();
    const scripts = /* @__PURE__ */ new Map();
    const blobs = /* @__PURE__ */ new Set();
    const queue = [];
    let active = 0;
    const drain = () => {
      while (active < 6 && queue.length) {
        const { run, resolve, reject } = queue.shift();
        active++;
        Promise.resolve().then(() => {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          return run();
        }).then(resolve, reject).finally(() => {
          active--;
          drain();
        });
      }
    };
    const schedule = (run) => new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      drain();
    });
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach((node) => {
      styles.set(node.href, { node, promise: node.sheet ? Promise.resolve() : null });
      if (node.closest("main")) document.head.append(node);
    });
    document.querySelectorAll("script[src]").forEach((node) => scripts.set(node.src, Promise.resolve()));
    async function picture(url) {
      if (pictures.has(url)) return pictures.get(url);
      const pending = schedule(async () => {
        const response = await fetch(url, { credentials: "omit", signal, redirect: "error" });
        if (!response.ok || !/^image\//.test(response.headers.get("Content-Type") || "")) throw Error("image-response");
        const blob = await response.blob();
        if (signal.aborted || blob.size > 25 * 1024 * 1024) throw Error("image-size");
        const local = URL.createObjectURL(blob);
        blobs.add(local);
        const image = new Image();
        image.src = local;
        await image.decode();
        return local;
      });
      pictures.set(url, pending);
      return pending;
    }
    return {
      async images(root, base, preparedOnly = false) {
        const images = [...root.querySelectorAll("img[src],svg image[href]")];
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(3, images.length) }, async () => {
            while (next < images.length) {
              const node = images[next++];
              const svg = node.localName === "image";
              const url = svg ? new URL(node.getAttribute("href"), base).href : imageSource(node, base);
              if (preparedOnly && !pictures.has(url)) continue;
              if (!url || !publicImage(url)) throw Error("unlisted-image");
              const local = await picture(url);
              if (svg) {
                node.setAttribute("href", local);
                continue;
              }
              if (node.parentElement?.tagName === "PICTURE")
                node.parentElement.querySelectorAll("source").forEach((s) => s.remove());
              node.removeAttribute("srcset");
              node.src = local;
              node.loading = "eager";
            }
          })
        );
      },
      async shell() {
        const icon = document.querySelector('link[rel="icon"]');
        if (icon && publicImage(icon.href)) icon.href = await picture(icon.href);
      },
      async styles(root) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        const hrefs = [...new Set([...root.querySelectorAll('link[rel="stylesheet"][href]')].map((node) => node.href))];
        await Promise.all(
          hrefs.map(async (href) => {
            const url = new URL(href);
            if (url.origin !== location.origin || !/^\/assets\/[^/]+\.[a-f0-9]{16}\.css$/.test(url.pathname) && href !== location.origin + "/site/theme.css")
              throw Error("stylesheet-policy");
            if (!styles.has(href)) {
              const node = document.createElement("link");
              node.rel = "stylesheet";
              node.href = href;
              node.media = "not all";
              const promise = loaded(node, signal);
              styles.set(href, { node, promise });
              document.head.append(node);
            }
            const entry = styles.get(href);
            if (!entry.promise) {
              if (entry.node.sheet) entry.promise = Promise.resolve();
              else {
                const previous = entry.node;
                entry.node = previous.cloneNode();
                entry.promise = loaded(entry.node, signal);
                previous.replaceWith(entry.node);
              }
            }
            await entry.promise;
          })
        );
        return hrefs;
      },
      activate(hrefs) {
        for (const [href, entry] of styles) {
          const media = hrefs.includes(href) ? "all" : "not all";
          if (entry.node.media !== media) entry.node.media = media;
        }
      },
      async scripts(root) {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        for (const source of root.querySelectorAll("script[src]")) {
          const href = source.src;
          if (!/^\/assets\/(?:home-light|home-recommendations|work-browse|member-results)\.[a-f0-9]{16}\.js$/.test(
            new URL(href).pathname
          ) || scripts.has(href))
            continue;
          const node = document.createElement("script");
          node.src = href;
          const promise = loaded(node, signal);
          scripts.set(href, promise);
          document.head.append(node);
          await promise;
        }
      },
      release() {
        for (const url of blobs) URL.revokeObjectURL(url);
        blobs.clear();
      }
    };
  }
  function loaded(node, signal) {
    return new Promise((resolve, reject) => {
      const done = (error) => {
        node.removeEventListener("load", success);
        node.removeEventListener("error", failure);
        signal.removeEventListener("abort", failure);
        error ? reject(error) : resolve();
      };
      const success = () => done();
      const failure = () => done(Error("asset-unavailable"));
      node.addEventListener("load", success, { once: true });
      node.addEventListener("error", failure, { once: true });
      signal.addEventListener("abort", failure, { once: true });
      if (signal.aborted) failure();
    });
  }

  // src/client/navigation/router.js
  function installRouter(pages, assets, canonical) {
    let current = location.pathname;
    let valid = true;
    let accountVersion;
    try {
      accountVersion = localStorage.getItem("blackbox-account-change");
    } catch {
    }
    history.scrollRestoration = "auto";
    const commit = (url, back = false) => {
      const page = pages.get(url.pathname);
      if (!valid || !page?.ready || !window.blackboxPages) return false;
      const before = performance.now();
      const previous = document.querySelector("#main-content");
      if (!previous) return false;
      const next = page.main.cloneNode(true);
      try {
        window.blackboxPages.unmount();
        if (!back) history.pushState({}, "", url);
        assets.activate(page.styles);
        for (const name of ["layout-book", "layout-members", "layout-gallery", "archive-page"])
          document.body.classList.toggle(name, page.classes.includes(name));
        document.body.dataset.section = page.section;
        document.title = page.title;
        previous.replaceWith(next);
        document.querySelectorAll(".nav-menu.is-open,#main-navigation.is-open").forEach((node) => node.classList.remove("is-open"));
        document.querySelectorAll(".nav-panel").forEach((node) => node.hidden = true);
        document.querySelectorAll(".menu-toggle,.nav-menu-toggle").forEach((node) => node.setAttribute("aria-expanded", "false"));
        document.body.classList.remove("navigation-open");
        window.blackboxPages.mount(next, back ? "history" : "push");
        current = url.pathname;
        next.focus({ preventScroll: true });
        if (!back) window.scrollTo({ left: 0, top: 0, behavior: "instant" });
        if (url.hash && !back) {
          window.dispatchEvent(new HashChangeEvent("hashchange"));
          const anchor = document.getElementById(decodeURIComponent(url.hash.slice(1)));
          if (anchor && !anchor.closest(".stage-scene")) anchor.scrollIntoView({ behavior: "instant" });
        }
        document.dispatchEvent(
          new CustomEvent("blackbox:page-changed", { detail: { path: current, commitMs: performance.now() - before } })
        );
        return true;
      } catch {
        valid = false;
        location.assign(url.href);
        return true;
      }
    };
    document.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target.closest?.("a[href]");
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self") return;
      try {
        if (localStorage.getItem("blackbox-account-change") !== accountVersion) valid = false;
      } catch {
      }
      const path = canonical(link.href);
      if (!path) return;
      const url = new URL(link.href);
      if (url.pathname === current && url.hash) return;
      if (commit(url)) event.preventDefault();
    });
    window.addEventListener("popstate", () => {
      if (location.pathname === current) return;
      if (!canonical(location.href) || !commit(new URL(location.href), true)) location.reload();
    });
    window.addEventListener("storage", (event) => {
      if (event.key === "blackbox-account-change") {
        valid = false;
        pages.clear();
      }
    });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted) return;
      try {
        if (localStorage.getItem("blackbox-account-change") !== accountVersion) {
          valid = false;
          pages.clear();
        }
      } catch {
      }
    });
    return {
      navigate: commit,
      invalidate() {
        valid = false;
        pages.clear();
      }
    };
  }

  // src/client/navigation-preload.js
  (() => {
    if (document.body?.dataset.navigationPreload !== "public" || !window.blackboxPages) return;
    const paths = new Set(PUBLIC_LANDING_PATHS);
    const canonical = (href) => {
      try {
        const url = new URL(href, location.href);
        return url.origin === location.origin && paths.has(url.pathname) && !url.search ? url.pathname : null;
      } catch {
        return null;
      }
    };
    if (!canonical(location.href)) return;
    const pages = /* @__PURE__ */ new Map();
    const controller = new AbortController();
    const assets = createNavigationAssets(controller.signal);
    const opening = window.blackboxSiteOpening;
    const version = document.querySelector("script[data-site-opening]")?.dataset.siteOpening;
    const router = installRouter(pages, assets, canonical);
    let completed = 0, failed = 0;
    const failures = [];
    const initialDocument = document.body.dataset.navigationCache === "public-v1" && !document.body.classList.contains("signed-in") ? document.cloneNode(true) : null;
    const total = paths.size + 1;
    const update = () => opening?.update({ completed, total, failed, discovering: false });
    const fonts = (text) => new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (controller.signal.aborted) return abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(document.fonts?.load('900 32px "Blackbox Display"', text)).then(resolve, reject).finally(() => controller.signal.removeEventListener("abort", abort));
    });
    const prepare = async (path) => {
      let doc;
      if (path === location.pathname && initialDocument) doc = initialDocument;
      else {
        const response = await fetch(path, {
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          headers: { Accept: "text/html" },
          signal: controller.signal
        });
        if (!response.ok || response.headers.get("X-Blackbox-Navigation") !== "public-v1" || !response.headers.get("Content-Type")?.includes("text/html"))
          throw Error("page-response");
        const html = await response.text();
        if (html.length > 15e5) throw Error("page-size");
        doc = new DOMParser().parseFromString(html, "text/html");
      }
      const main = doc.querySelector("#main-content");
      if (!main || doc.querySelector("script[data-site-opening]")?.dataset.siteOpening !== version || doc.body.dataset.navigationCache !== "public-v1" || main.querySelector('input[name="csrf"][value]:not([value=""])'))
        throw Error("page-contract");
      const stylesReady = assets.styles(doc);
      const text = main.textContent;
      await Promise.all([
        stylesReady.then(() => fonts(text)),
        assets.scripts(doc),
        assets.images(main, location.origin + path)
      ]);
      const styles = await stylesReady;
      main.querySelectorAll("script,link[rel=stylesheet]").forEach((node) => node.remove());
      pages.set(path, {
        main,
        styles,
        text,
        title: doc.title,
        classes: [...doc.body.classList],
        section: doc.body.dataset.section || "",
        ready: false
      });
    };
    const startup = async () => {
      const deadline = setTimeout(() => controller.abort(), 6e4);
      update();
      try {
        if ("serviceWorker" in navigator) {
          navigator.serviceWorker.register("/navigation-worker.js", { scope: "/", updateViaCache: "none" }).catch(() => {
          });
        }
        await Promise.all(
          [...paths].map(async (path) => {
            try {
              await prepare(path);
              completed++;
            } catch (error) {
              failed++;
              failures.push({ path, reason: error.name === "AbortError" ? "timeout" : error.message });
            }
            update();
          })
        );
        if (!controller.signal.aborted) {
          try {
            await Promise.all([
              assets.shell(),
              assets.images(document.querySelector("#main-content"), location.href, true)
            ]);
            completed++;
          } catch {
            failed++;
          }
        }
        for (const page of pages.values()) page.ready = true;
        update();
        const status = controller.signal.aborted ? "timeout" : failed || completed !== total ? "partial" : "ready";
        api.status = status;
        opening?.finish({ status });
        return { status, completed, total, failed, routes: [...pages.keys()], failures };
      } finally {
        clearTimeout(deadline);
      }
    };
    const api = window.blackboxNavigation = {
      status: "loading",
      eligible: (href) => Boolean(canonical(href)),
      cached: (href) => Boolean(pages.get(canonical(href))?.ready),
      invalidate: router.invalidate
    };
    window.blackboxNavigationPrefetch = api;
    document.addEventListener("blackbox:opening-finished", (event) => {
      if (api.status === "loading" && ["partial", "timeout", "skipped"].includes(event.detail?.status))
        controller.abort();
    });
    api.startupPromise = startup();
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) {
        controller.abort();
        assets.release();
      }
    });
  })();
})();
