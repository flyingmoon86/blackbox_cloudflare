import { imageSource } from "./image-source.js";

// Dynamic pictures live only in this tab, fetched anonymously. Private URLs are
// never admitted here or in the service worker's persistent static cache.
export function publicImage(href) {
  const url = new URL(href, location.href);
  return (
    url.origin === location.origin &&
    (/^\/assets\/[^/]+\.[a-f0-9]{16}\.(?:png|jpe?g|webp|avif|svg)$/.test(url.pathname) ||
      /^\/site\/stage-image\/(?:home|productions|members|thanks)\/(?:unlit|light)$/.test(url.pathname) ||
      /^\/site\/(?:featured-cover|poster|mascot|hero|background)$/.test(url.pathname) ||
      (/^\/productions\/\d+\/cover$/.test(url.pathname) && url.searchParams.get("size") === "preview") ||
      (/^\/members\/\d+\/avatar$/.test(url.pathname) && !url.search) ||
      /^\/resources\/\d+\/preview$/.test(url.pathname))
  );
}

export function createNavigationAssets(signal) {
  const pictures = new Map();
  const styles = new Map();
  const scripts = new Map();
  const blobs = new Set();
  // Share one budget across all pages: parallel HTML must not multiply image
  // connections by the number of navigation destinations.
  const queue = [];
  let active = 0;
  const drain = () => {
    while (active < 6 && queue.length) {
      const { run, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(() => {
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          return run();
        })
        .then(resolve, reject)
        .finally(() => {
          active--;
          drain();
        });
    }
  };
  const schedule = (run) =>
    new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject });
      drain();
    });
  document.querySelectorAll('link[rel="stylesheet"][href]').forEach((node) => {
    // Deferred startup may have missed this link's error event. A missing
    // sheet is retried when first consumed, with listeners attached first.
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
      // Complete the finite first list page, including hover/hidden act images.
      // Original media and later search/pagination are outside this manifest.
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
        }),
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
          if (
            url.origin !== location.origin ||
            (!/^\/assets\/[^/]+\.[a-f0-9]{16}\.css$/.test(url.pathname) && href !== location.origin + "/site/theme.css")
          )
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
        }),
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
        // Only audited, lifecycle-aware enhancements may execute from a page.
        if (
          !/^\/assets\/(?:home-light|home-recommendations|work-browse)\.[a-f0-9]{16}\.js$/.test(
            new URL(href).pathname,
          ) ||
          scripts.has(href)
        )
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
    },
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
