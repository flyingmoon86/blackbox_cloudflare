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
  function warmWorkPreviews(cards2) {
    const queued = [];
    const attempted = /* @__PURE__ */ new Set();
    const active = /* @__PURE__ */ new Set();
    let viewportCandidates = 0;
    let navigating = false;
    const canWarm = () => !limited() && !document.hidden && !navigating && !window.blackboxSiteOpening?.active;
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
      cards2.forEach((card) => observer?.observe(card));
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
    const resume = () => observe();
    document.addEventListener("pointerover", (event) => {
      if (event.pointerType !== "touch") enqueue(event.target.closest?.("[data-work-card]"), true);
    });
    document.addEventListener("focusin", (event) => enqueue(event.target.closest?.("[data-work-card]"), true));
    document.addEventListener("blackbox:opening-finished", observe);
    document.addEventListener("blackbox:navigation-start", () => {
      navigating = true;
      stop();
    });
    document.addEventListener("blackbox:navigation-cancel", () => {
      navigating = false;
      resume();
    });
    document.addEventListener("visibilitychange", () => document.hidden ? stop() : resume());
    connection?.addEventListener?.("change", () => limited() ? stop() : resume());
    window.addEventListener("offline", stop);
    window.addEventListener("online", resume);
    window.addEventListener("pagehide", () => {
      navigating = true;
      stop();
    });
    window.addEventListener("pageshow", () => {
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

  // src/client/work/return-position.js
  function restoreWorkReturn(cards2) {
    const storageKey = "blackbox-work-return:v1";
    const current = location.pathname + location.search + location.hash;
    const readReturn = () => {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (!raw || raw.length > 4096) return null;
        const value = JSON.parse(raw);
        const list = new URL(value.url, location.origin);
        if (list.origin !== location.origin || list.pathname !== "/productions" || !/^\/productions\/\d+$/.test(value.to) || !Number.isFinite(value.at) || Date.now() - value.at < 0 || Date.now() - value.at > 30 * 60 * 1e3 || !Number.isFinite(value.y) || value.y < 0)
          return null;
        return value;
      } catch {
        return null;
      }
    };
    const writeReturn = (value) => {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
      }
    };
    const saved = readReturn();
    const back = document.querySelector("[data-work-return]");
    if (back && saved?.to === location.pathname) back.href = saved.url;
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download"))
        return;
      const destination = new URL(link.href, location.href);
      if (destination.origin !== location.origin) return;
      if (location.pathname === "/productions" && link.closest("[data-work-card]") && /^\/productions\/\d+$/.test(destination.pathname)) {
        writeReturn({
          url: current,
          to: destination.pathname,
          focus: destination.pathname + destination.search + destination.hash,
          y: window.scrollY,
          at: Date.now(),
          explicit: false
        });
      } else if (link === back && saved && saved.to === location.pathname) {
        writeReturn({ ...saved, explicit: true, at: Date.now() });
      }
    });
    if (location.pathname !== "/productions" || !cards2.length) return;
    let interacted = false;
    let restored = false;
    for (const event of ["pointerdown", "touchstart", "wheel", "keydown"])
      window.addEventListener(event, () => interacted = true, { passive: true });
    const restoreReturn = (persisted = false) => {
      if (persisted) {
        interacted = false;
        restored = false;
      }
      if (restored) return;
      const pending = readReturn();
      if (!pending || pending.url !== current) return;
      const historyNavigation = persisted || performance.getEntriesByType("navigation")[0]?.type === "back_forward";
      if (!historyNavigation && !pending.explicit) return;
      restored = true;
      writeReturn({ ...pending, explicit: false });
      requestAnimationFrame(() => {
        if (interacted) return;
        const link = cards2.flatMap((card) => [...card.querySelectorAll("a[href]")]).find((candidate) => {
          const url = new URL(candidate.href, location.href);
          return url.pathname + url.search + url.hash === pending.focus;
        });
        if (!historyNavigation) window.scrollTo({ top: pending.y, behavior: "instant" });
        if (link && (!historyNavigation || document.activeElement === document.body || document.activeElement === document.documentElement))
          link.focus({ preventScroll: true });
      });
    };
    document.addEventListener("DOMContentLoaded", () => restoreReturn());
    window.addEventListener("pageshow", (event) => restoreReturn(event.persisted));
  }

  // src/client/work-browse.js
  var cards = [...document.querySelectorAll("[data-work-card]")];
  warmWorkPreviews(cards);
  enhanceDetailCover();
  restoreWorkReturn(cards);
})();
