(() => {
  const paths = new Set(["/", "/productions", "/resources", "/members", "/thanks"]);
  if (document.body?.dataset.navigationCache !== "public-v1" || !window.fetch) return;
  const entries = new Map();
  const assets = new Map();
  const connection = navigator.connection;
  const limited = () => connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "");
  const canonical = (href) => {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin || !paths.has(url.pathname) || url.search) return null;
    url.hash = "";
    return url.href;
  };
  let suspended = false,
    idleTimer,
    intentTimer;
  const current = location.origin + location.pathname;
  const cancel = (except, backgroundOnly = false) => {
    suspended = true;
    clearTimeout(idleTimer);
    clearTimeout(intentTimer);
    for (const [url, entry] of entries) {
      if (url !== except && !entry.ready && (!backgroundOnly || !entry.foreground)) {
        entry.controller.abort();
        entries.delete(url);
      }
    }
  };
  const prepare = (href, foreground = false, refresh = false) => {
    const url = canonical(href);
    if (!url) return null;
    if (foreground) cancel(url);
    const cached = entries.get(url);
    if (cached && !refresh && (!cached.ready || cached.expires > Date.now())) {
      if (foreground) cached.foreground = true;
      return cached.promise;
    }
    cached?.controller.abort();
    const controller = new AbortController();
    const entry = { controller, ready: false, expires: 0, foreground };
    entries.set(url, entry);
    const timeout = setTimeout(() => controller.abort(), 15000);
    entry.promise = (async () => {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: refresh ? "reload" : "default",
        signal: controller.signal,
        priority: foreground ? "high" : "low",
        headers: { Accept: "text/html" },
        redirect: "manual",
      });
      if (response.type === "opaqueredirect") return null;
      if (!response.ok) throw new Error("navigation-response");
      // Auth changes, redirects and non-cacheable responses stay native. Never replay HTML ourselves.
      if (response.redirected || response.headers.get("X-Blackbox-Navigation") !== "public-v1") return null;
      const html = await response.text();
      if (html.length > 750000 || !response.headers.get("Content-Type")?.includes("text/html")) return null;
      const template = document.createElement("template");
      template.innerHTML = html; // Inert: no scripts, stylesheets or images execute/load here.
      const sameOrigin = (value) => {
        const asset = new URL(value, url);
        return asset.origin === location.origin ? asset.href : null;
      };
      const present = new Set([...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href));
      const styles = [...template.content.querySelectorAll('link[rel="stylesheet"][href]')]
        .map((link) => sameOrigin(link.getAttribute("href")))
        .filter((href) => href && !present.has(href));
      // Only the destination's backdrop is prepared on intent; no original photos or media galleries.
      const image = template.content.querySelector("img[data-theatre-base][src]");
      entry.ready = true;
      const responseDate = Date.parse(response.headers.get("Date") || "");
      const age = Math.max(
        Number(response.headers.get("Age")) || 0,
        Number.isFinite(responseDate) ? (Date.now() - responseDate) / 1000 : 0,
      );
      entry.expires = Date.now() + Math.max(0, 15 - age) * 1000;
      return { styles: [...new Set(styles)].slice(0, 3), image: image && sameOrigin(image.getAttribute("src")) };
    })()
      .catch((error) => {
        if (entries.get(url) === entry) entries.delete(url);
        throw error;
      })
      .finally(() => clearTimeout(timeout));
    return entry.promise;
  };
  const warmAssets = (data, includeImage = false) => {
    if (!data) return Promise.resolve();
    const tasks = data.styles.map((url) => {
      if (!assets.has(url)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        assets.set(
          url,
          fetch(url, { priority: "low", signal: controller.signal })
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
            .catch(() => {
              assets.delete(url);
            })
            .finally(() => clearTimeout(timeout)),
        );
      }
      return assets.get(url);
    });
    if (includeImage && data.image && !limited()) {
      if (!assets.has(data.image)) {
        const image = new Image();
        image.fetchPriority = "low";
        image.src = data.image;
        assets.set(
          data.image,
          image.decode().catch(() => {
            assets.delete(data.image);
          }),
        );
      }
      tasks.push(assets.get(data.image));
    }
    return Promise.allSettled(tasks);
  };
  const queue = ["/productions", "/members", "/thanks", "/"]
    .map((p) => location.origin + p)
    .filter((p) => p !== current);
  let loaded = document.readyState === "complete";
  const schedule = () => {
    clearTimeout(idleTimer);
    if (!loaded || suspended || limited() || document.hidden || !queue.length) return;
    idleTimer = setTimeout(async () => {
      if (suspended || limited() || document.hidden) return;
      const url = queue.shift();
      try {
        await warmAssets(await prepare(url));
      } catch {}
      schedule();
    }, 1800);
  };
  const resume = () => {
    suspended = [...entries.values()].some((entry) => entry.foreground && !entry.ready);
    schedule();
  };
  const intent = (event) => {
    const link = event.target instanceof Element ? event.target.closest(".top a[href], .mobile-nav a[href]") : null;
    if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
    const url = canonical(link.href);
    if (!url || url === current || limited() || suspended) return;
    clearTimeout(intentTimer);
    intentTimer = setTimeout(
      async () => {
        if (suspended || document.hidden || limited()) return;
        // Intent replaces an unrelated background request rather than adding another download.
        cancel(url);
        suspended = false;
        try {
          await warmAssets(await prepare(url), true);
        } catch {}
        schedule();
      },
      event.type === "pointerover" ? 120 : 0,
    );
  };
  document.addEventListener("pointerover", intent, { passive: true });
  document.addEventListener("pointerdown", intent, { passive: true });
  document.addEventListener("focusin", intent);
  document.addEventListener("pointerout", () => clearTimeout(intentTimer), { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancel(undefined, true);
    else resume();
  });
  window.addEventListener("pagehide", () => cancel());
  window.addEventListener("pageshow", resume);
  connection?.addEventListener("change", () => {
    if (limited()) cancel(undefined, true);
    else resume();
  });
  window.addEventListener(
    "load",
    () => {
      loaded = true;
      schedule();
    },
    { once: true },
  );
  window.blackboxNavigationPrefetch = {
    prepare,
    warmAssets,
    cancel,
    resume,
    eligible: (href) => Boolean(canonical(href)),
  };
  schedule();
})();
