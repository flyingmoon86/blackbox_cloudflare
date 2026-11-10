// Generated from src/client/work-browse.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/work/policy.js
  var connection = navigator.connection;
  var limited = () => navigator.onLine === false || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "");
  var previewURL = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin || !/^\/productions\/\d+\/cover$/.test(url.pathname) || url.searchParams.get("size") !== "preview" || url.searchParams.get("previewOnly") !== "1" || !/^\d+$/.test(url.searchParams.get("v") || ""))
        return null;
      return url.href;
    } catch {
      return null;
    }
  };

  // src/client/work/warm-previews.js
  function warmWorkPreviews(cards, scope) {
    const queued = [];
    const attempted = /* @__PURE__ */ new Set();
    const active = /* @__PURE__ */ new Set();
    let viewportCandidates = 0;
    let navigating = false;
    const canWarm = () => !window.blackboxNavigation?.eligible(location.href) && !limited() && !document.hidden && !navigating && !window.blackboxSiteOpening?.active;
    const pump = () => {
      while (canWarm() && active.size < 2 && attempted.size < 8 && queued.length) {
        const url = queued.shift();
        if (attempted.has(url)) continue;
        attempted.add(url);
        const image = new Image();
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          image.removeEventListener("load", finish);
          image.removeEventListener("error", finish);
          active.delete(cancel);
          pump();
        };
        const cancel = () => {
          image.removeAttribute("src");
          finish();
        };
        const timeout = setTimeout(cancel, 5e3);
        active.add(cancel);
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
        image.fetchPriority = "low";
        image.decoding = "async";
        image.src = url;
        if (image.complete) finish();
      }
    };
    const enqueue = (card, intent = false) => {
      const url = previewURL(card?.dataset.workPreview);
      if (!url || !canWarm() || attempted.has(url)) return;
      const index = queued.indexOf(url);
      if (index !== -1) {
        if (intent) queued.unshift(...queued.splice(index, 1));
        return;
      }
      if (!intent && viewportCandidates >= 4) return;
      if (attempted.size + queued.length >= 8) return;
      if (!intent) viewportCandidates++;
      if (intent) queued.unshift(url);
      else queued.push(url);
      pump();
    };
    const observe = () => {
      if (!canWarm()) return;
      cards.forEach((card) => observer?.observe(card));
    };
    const observer = "IntersectionObserver" in window ? new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !canWarm()) continue;
          enqueue(entry.target);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "180px 0px", threshold: 0.05 }
    ) : null;
    const stop = () => {
      queued.length = 0;
      observer?.disconnect();
      [...active].forEach((cancel) => cancel());
    };
    scope.dispose(stop);
    const resume = () => observe();
    scope.listen(document, "pointerover", (event) => {
      if (event.pointerType !== "touch") enqueue(event.target.closest?.("[data-work-card]"), true);
    });
    scope.listen(document, "focusin", (event) => enqueue(event.target.closest?.("[data-work-card]"), true));
    scope.listen(document, "blackbox:opening-finished", observe);
    scope.listen(document, "blackbox:navigation-start", () => {
      navigating = true;
      stop();
    });
    scope.listen(document, "blackbox:navigation-cancel", () => {
      navigating = false;
      resume();
    });
    scope.listen(document, "visibilitychange", () => document.hidden ? stop() : resume());
    scope.listen(connection, "change", () => limited() ? stop() : resume());
    scope.listen(window, "offline", stop);
    scope.listen(window, "online", resume);
    scope.listen(window, "pagehide", () => {
      navigating = true;
      stop();
    });
    scope.listen(window, "pageshow", () => {
      navigating = false;
      resume();
    });
    observe();
  }

  // src/client/work/detail-cover.js
  function enhanceDetailCover() {
    document.querySelectorAll(".work-cover-frame[data-work-preview]").forEach((frame) => {
      const full = frame.querySelector(".work-cover-full");
      const url = previewURL(frame.dataset.workPreview);
      if (!full || !url || limited() || full.complete && full.naturalWidth) return;
      const preview = new Image();
      let fullReady = false;
      preview.className = "work-cover-preview";
      preview.alt = "";
      preview.setAttribute("aria-hidden", "true");
      preview.decoding = "async";
      preview.fetchPriority = "low";
      const revealFull = () => {
        fullReady = true;
        frame.classList.remove("is-previewing");
        preview.remove();
      };
      full.addEventListener("load", revealFull, { once: true });
      preview.addEventListener(
        "load",
        () => {
          if (fullReady || full.complete && full.naturalWidth) return revealFull();
          if (preview.naturalWidth) frame.classList.add("is-previewing");
        },
        { once: true }
      );
      preview.addEventListener("error", () => preview.remove(), { once: true });
      frame.append(preview);
      preview.src = url;
      if (full.complete && full.naturalWidth) revealFull();
    });
  }

  // src/client/shared/list-return.js
  function installListReturn(root, scope, options) {
    const { storageKey, listPath, cardSelector, returnSelector, detailPath } = options;
    const relative = (url) => url.pathname + url.search + url.hash;
    const listKey = options.listKey || relative;
    const current = new URL(location.href);
    const cards = [...root.querySelectorAll(cardSelector)];
    const backLinks = [...root.querySelectorAll(returnSelector)];
    if (!cards.length && !backLinks.length) return;
    const read = () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw || raw.length > 4096) return null;
        const value = JSON.parse(raw);
        const list = new URL(value.url, location.origin);
        const detail = new URL(value.focus, location.origin);
        const age = Date.now() - value.at;
        if (list.origin !== location.origin || list.pathname !== listPath || detail.origin !== location.origin || !detailPath.test(detail.pathname) || value.to !== detail.pathname || !Number.isFinite(value.at) || age < 0 || age > 30 * 60 * 1e3 || !Number.isFinite(value.y) || value.y < 0 || [value.x, value.mainX, value.mainY].some((n) => n !== void 0 && (!Number.isFinite(n) || n < 0)))
          return null;
        return { ...value, url: relative(list) };
      } catch {
        return null;
      }
    };
    const write = (value) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
      }
    };
    const saved = read();
    const returnsToSavedList = (link) => {
      if (!saved || !detailPath.test(current.pathname)) return false;
      const destination = new URL(link.href, location.href);
      return destination.origin === location.origin && destination.pathname === listPath && (options.restoreHref ? saved.to === current.pathname : listKey(destination) === listKey(new URL(saved.url, location.origin)));
    };
    for (const link of backLinks) if (returnsToSavedList(link)) link.href = saved.url;
    scope.listen(root, "click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target && link.target !== "_self" || link.hasAttribute("download"))
        return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin) return;
      if (current.pathname === listPath && link.closest(cardSelector) && detailPath.test(destination.pathname)) {
        write({
          url: relative(current),
          to: destination.pathname,
          focus: relative(destination),
          x: window.scrollX || 0,
          y: window.scrollY,
          mainX: root.scrollLeft || 0,
          mainY: root.scrollTop || 0,
          at: Date.now(),
          explicit: false
        });
      } else if (link.matches(returnSelector) && returnsToSavedList(link)) {
        write({ ...saved, explicit: true, at: Date.now() });
      }
    });
    if (current.pathname !== listPath || !cards.length) return;
    let interacted = false;
    let restored = false;
    let frame;
    for (const event of ["pointerdown", "touchstart", "wheel", "keydown"])
      scope.listen(window, event, () => interacted = true, { passive: true });
    scope.dispose(() => cancelAnimationFrame(frame));
    const restore = (persisted = false) => {
      if (persisted) {
        interacted = false;
        restored = false;
      }
      if (restored || scope.signal?.aborted) return;
      const pending = read();
      if (!pending || listKey(new URL(pending.url, location.origin)) !== listKey(current)) return;
      const nativeHistory = persisted || (!scope.navigation || scope.navigation === "initial") && performance.getEntriesByType("navigation")[0]?.type === "back_forward";
      if (!nativeHistory && !pending.explicit) return;
      restored = true;
      write({ ...pending, explicit: false });
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (interacted || scope.signal?.aborted || root.isConnected === false) return;
        const link = cards.flatMap((card) => card.matches?.("a[href]") ? [card] : [...card.querySelectorAll("a[href]")]).find((candidate) => relative(new URL(candidate.href, location.href)) === pending.focus);
        if (!nativeHistory) {
          window.scrollTo({ left: pending.x || 0, top: pending.y, behavior: "instant" });
          root.scrollLeft = pending.mainX || 0;
          root.scrollTop = pending.mainY || 0;
        }
        if (link && (!nativeHistory || [document.body, document.documentElement, root].includes(document.activeElement)))
          link.focus({ preventScroll: true });
      });
    };
    scope.listen(window, "pageshow", (event) => restore(event.persisted));
    if (document.readyState === "loading") scope.listen(document, "DOMContentLoaded", () => restore());
    else restore();
  }

  // src/client/work-browse.js
  window.blackboxPages?.register("work-browse", (root, scope) => {
    const cards = [...document.querySelectorAll("[data-work-card]")];
    warmWorkPreviews(cards, scope);
    enhanceDetailCover();
    installListReturn(root || document, scope, {
      storageKey: "blackbox-work-return:v1",
      listPath: "/productions",
      cardSelector: "[data-work-card]",
      returnSelector: "[data-work-return]",
      detailPath: /^\/productions\/\d+$/,
      restoreHref: true
    });
  });
})();
