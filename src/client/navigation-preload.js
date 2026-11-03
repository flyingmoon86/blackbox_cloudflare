import { PUBLIC_LANDING_PATHS } from "../shared/navigation.ts";
import { createNavigationAssets } from "./navigation/assets.js";
import { installRouter } from "./navigation/router.js";

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
  const pages = new Map();
  const controller = new AbortController();
  const assets = createNavigationAssets(controller.signal);
  const opening = window.blackboxSiteOpening;
  const version = document.querySelector("script[data-site-opening]")?.dataset.siteOpening;
  const router = installRouter(pages, assets, canonical);
  let completed = 0,
    failed = 0;
  const failures = [];
  // The server only marks anonymous, unfiltered documents public-v1. Reuse
  // this already-delivered page; signed-in shells still fetch anonymously.
  const initialDocument =
    document.body.dataset.navigationCache === "public-v1" && !document.body.classList.contains("signed-in")
      ? document.cloneNode(true)
      : null;
  const total = paths.size + 1;
  const update = () => opening?.update({ completed, total, failed, discovering: false });
  const fonts = (text) =>
    new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (controller.signal.aborted) return abort();
      controller.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve(document.fonts?.load('900 32px "Blackbox Display"', text))
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", abort));
    });
  const prepare = async (path) => {
    let doc;
    if (path === location.pathname && initialDocument) doc = initialDocument;
    else {
      // Deliberately anonymous: never put admin controls, CSRF, hidden records or
      // internal photos in a route snapshot, even when the shell is signed in.
      const response = await fetch(path, {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "text/html" },
        signal: controller.signal,
      });
      if (
        !response.ok ||
        response.headers.get("X-Blackbox-Navigation") !== "public-v1" ||
        !response.headers.get("Content-Type")?.includes("text/html")
      )
        throw Error("page-response");
      const html = await response.text();
      if (html.length > 1500000) throw Error("page-size");
      doc = new DOMParser().parseFromString(html, "text/html");
    }
    const main = doc.querySelector("#main-content");
    if (
      !main ||
      doc.querySelector("script[data-site-opening]")?.dataset.siteOpening !== version ||
      doc.body.dataset.navigationCache !== "public-v1" ||
      main.querySelector('input[name="csrf"][value]:not([value=""])')
    )
      throw Error("page-contract");
    const stylesReady = assets.styles(doc);
    const text = main.textContent;
    // Font subsets and pictures can load together as soon as this HTML arrives.
    await Promise.all([
      stylesReady.then(() => fonts(text)),
      assets.scripts(doc),
      assets.images(main, location.origin + path),
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
      ready: false,
    });
  };
  const startup = async () => {
    const deadline = setTimeout(() => controller.abort(), 60000);
    update();
    try {
      // Persistent storage is optional; in-tab navigation also works without it.
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .register("/navigation-worker.js", { scope: "/", updateViaCache: "none" })
          .catch(() => {});
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
        }),
      );
      if (!controller.signal.aborted) {
        try {
          await Promise.all([
            assets.shell(),
            assets.images(document.querySelector("#main-content"), location.href, true),
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
  const api = (window.blackboxNavigation = {
    status: "loading",
    eligible: (href) => Boolean(canonical(href)),
    cached: (href) => Boolean(pages.get(canonical(href))?.ready),
    invalidate: router.invalidate,
  });
  // Keep the existing diagnostic entry point, without its old marker-only skip.
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
