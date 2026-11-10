// Generated from src/client/member-results.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
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

  // src/client/member-results.js
  window.blackboxPages.register("member-results", (root, scope) => {
    installListReturn(root, scope, {
      storageKey: "blackbox-member-return:v1",
      listPath: "/members",
      cardSelector: ".member-card-link",
      returnSelector: "[data-member-return]",
      detailPath: /^\/members\/\d+$/,
      listKey(url) {
        const params = new URLSearchParams(url.search);
        if (!params.get("page")) params.set("page", "1");
        for (const name of ["q", "year"]) if (!params.get(name)) params.delete(name);
        params.sort();
        return url.pathname + "?" + params + url.hash;
      }
    });
  });
})();
