import { createCurtainScene } from "./curtain/scene.js";
// The curtain belongs only to first-entry loading. Internal links stay native.
(() => {
  const script = document.currentScript;
  const version = script?.dataset.siteOpening;
  const enabled = script?.hasAttribute("data-curtain-page");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const navigationKey = "blackbox-curtain-navigation";
  const enteredKey = "blackbox-site-entered:v1";
  const read = (key) => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const write = (key, value) => {
    try {
      value === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value);
    } catch {}
  };
  let incoming;
  try {
    incoming = JSON.parse(read(navigationKey));
  } catch {}
  write(navigationKey, null);
  const navigationType = performance.getEntriesByType("navigation")[0]?.type;
  const history = navigationType === "back_forward";
  let internalReferrer = false;
  try {
    internalReferrer = navigationType !== "reload" && new URL(document.referrer).origin === location.origin;
  } catch {}
  const arriving = Boolean(
    internalReferrer ||
    (incoming?.to === location.href && Date.now() - incoming.at >= 0 && Date.now() - incoming.at < 300000 && !history),
  );
  window.blackboxCurtainArrival = arriving;
  const entered = read(enteredKey) === "entered";
  if (enabled) write(enteredKey, "entered");
  let overlay, mode, cleanupTimer;
  const state = (window.blackboxCurtain = { active: false });
  const recovery = (message) => {
    if (!document.body) return;
    document.querySelector(".curtain-recovery")?.remove();
    const notice = document.createElement("p");
    notice.className = "curtain-recovery";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    document.body.append(notice);
    setTimeout(() => notice.remove(), 6000);
  };
  const clear = () => {
    clearTimeout(cleanupTimer);
    overlay?.close?.();
    overlay?.remove();
    overlay = null;
    mode = null;
    const wasActive = state.active;
    state.active = false;
    if (wasActive) document.dispatchEvent(new CustomEvent("blackbox:curtain-finished"));
  };
  const reveal = () => {
    if (!overlay || mode === "revealing") return;
    clearTimeout(cleanupTimer);
    if (motion.matches) {
      clear();
      return;
    }
    mode = "revealing";
    // End modal focus capture as soon as content becomes usable. The visual
    // fabric remains for its short CSS motion, without delaying any request.
    overlay.close?.();
    if (overlay.tagName === "DIALOG") overlay.setAttribute("open", "");
    overlay.className = "blackbox-curtain is-revealing";
    overlay.setAttribute("aria-hidden", "true");
    overlay.querySelector(".curtain-panel").inert = true;
    overlay.addEventListener("animationend", (event) => {
      if (event.animationName === "curtain-reveal-depth") clear();
    });
    // CSS owns the visual duration (milliseconds); keep removal in sync so a
    // design change cannot cut the gathering fabric off mid-motion.
    const duration = Math.min(
      2000,
      Math.max(0, parseFloat(getComputedStyle(overlay).getPropertyValue("--curtain-reveal-duration")) || 900),
    );
    cleanupTimer = setTimeout(clear, duration + 120); // Removal fallback, never an entrance delay.
  };
  const mount = () => {
    if (overlay) return overlay;
    if (!getComputedStyle(document.documentElement).getPropertyValue("--blackbox-curtain-ready")) return null;
    const node = document.createElement("dialog");
    node.id = "site-opening-curtain";
    node.className = "blackbox-curtain is-loading";
    node.setAttribute("aria-label", "正在加载黑匣子");
    node.innerHTML =
      '<div class="curtain-panel"><p class="curtain-brand" aria-hidden="true">黑匣子<span>话剧队</span></p><p class="curtain-label" role="status" aria-live="polite"></p><p class="curtain-detail"></p></div>';
    node.prepend(createCurtainScene(script?.dataset.curtainTexture));
    (document.body || document.documentElement).append(node);
    overlay = node;
    mode = "loading";
    state.active = true;
    node.addEventListener("cancel", (event) => event.preventDefault());
    try {
      node.showModal();
    } catch {
      clear();
      return null;
    }
    return node;
  };
  const storageKey = version && `blackbox-navigation-ready:${version}`;
  const dismissalKey = version && `blackbox-navigation-dismissed:${version}`;
  const connection = navigator.connection;
  const shouldLoad =
    version &&
    !entered &&
    !arriving &&
    !history &&
    navigator.onLine !== false &&
    !connection?.saveData &&
    !/(^|-)2g$/.test(connection?.effectiveType || "") &&
    read(storageKey) !== "ready" &&
    read(dismissalKey) !== "dismissed";
  let openingObserver, openingDeadline;
  if (shouldLoad) {
    const opening = (window.blackboxSiteOpening = {
      active: true,
      version,
      storageKey,
      dismissalKey,
      completed: 0,
      total: 0,
      failed: 0,
      discovering: true,
      status: "loading",
      update({ completed = 0, total = 0, failed = 0, discovering = false } = {}) {
        if (!opening.active) return;
        opening.total = Math.max(0, Math.floor(Number(total) || 0));
        opening.completed = Math.min(opening.total, Math.max(0, Math.floor(Number(completed) || 0)));
        opening.failed = Math.min(opening.total, Math.max(0, Math.floor(Number(failed) || 0)));
        opening.discovering = Boolean(discovering);
        render();
      },
      finish({ status = "partial" } = {}) {
        if (!opening.active) return;
        opening.active = false;
        opening.status = ["ready", "partial", "timeout", "skipped", "limited"].includes(status) ? status : "partial";
        if (opening.status !== "ready") write(dismissalKey, "dismissed");
        clearTimeout(openingDeadline);
        openingObserver?.disconnect();
        document.removeEventListener("DOMContentLoaded", show);
        if (mode === "loading") reveal();
        document.dispatchEvent(
          new CustomEvent("blackbox:opening-finished", {
            detail: {
              status: opening.status,
              completed: opening.completed,
              total: opening.total,
              failed: opening.failed,
            },
          }),
        );
        if (["partial", "timeout"].includes(opening.status)) recovery("部分资源尚未就绪，已显示页面，可继续浏览。");
      },
    });
    const render = () => {
      if (mode !== "loading") return;
      const meter = overlay.querySelector("progress");
      if (opening.total && !opening.discovering) {
        meter.max = opening.total;
        meter.value = opening.completed;
      } else meter.removeAttribute("value");
      const failures = opening.failed ? ` · ${opening.failed} 项暂不可用` : "";
      overlay.querySelector(".curtain-detail").textContent = opening.discovering
        ? `正在获取页面与资源清单${opening.completed ? ` · 已就绪 ${opening.completed} 项` : ""}${failures}`
        : `${opening.completed} / ${opening.total} 项资源已就绪${failures}`;
    };
    const show = () => {
      if (!opening.active || !document.body) return;
      openingObserver?.disconnect();
      document.removeEventListener("DOMContentLoaded", show);
      if (mode === "loading") {
        render();
        return;
      }
      const node = mount();
      if (!node) {
        opening.finish({ status: "partial" });
        return;
      }
      node.querySelector(".curtain-label").textContent = "正在加载黑匣子";
      const meter = document.createElement("progress");
      meter.className = "curtain-meter";
      meter.setAttribute("aria-label", "已就绪资源数量");
      node.querySelector(".curtain-detail").before(meter);
      render();
    };
    openingDeadline = setTimeout(() => opening.finish({ status: "timeout" }), 10000);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", show, { once: true });
      if (typeof MutationObserver !== "undefined") {
        openingObserver = new MutationObserver(show);
        openingObserver.observe(document.documentElement, { childList: true });
      }
    } else show();
  }
  let navigating = false;
  const resumePreparation = () => {
    if (!navigating) return;
    navigating = false;
    write(navigationKey, null);
    document.dispatchEvent(new CustomEvent("blackbox:navigation-cancel"));
  };
  const eligible = (url) =>
    url.origin === location.origin &&
    /^\/(?:productions(?:\/\d+)?|resources|members(?:\/\d+)?|thanks|help|announcements(?:\/\d+)?)?$/.test(
      url.pathname,
    ) &&
    !url.searchParams.has("stage-preview");
  // Run after page/menu handlers, leaving default browser navigation entirely
  // intact. Nothing waits for rAF, timers, fetch, prefetch or animationend here.
  window.addEventListener("click", (event) => {
    if (
      !enabled ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href, location.href);
    if (!eligible(url) || (url.pathname === location.pathname && url.search === location.search)) return;
    navigating = true;
    write(navigationKey, JSON.stringify({ to: url.href, at: Date.now() }));
    document.dispatchEvent(new CustomEvent("blackbox:navigation-start"));
  });
  // Browser cancellation stays native. Further interaction can resume optional
  // preparation without trapping focus or installing a second loading screen.
  document.addEventListener("pointerdown", resumePreparation, { passive: true });
  window.addEventListener("focus", resumePreparation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") resumePreparation();
  });
  window.addEventListener(
    "error",
    (event) => {
      if (!(event.target instanceof HTMLScriptElement) && !event.error) return;
      window.blackboxSiteOpening?.finish({ status: "partial" });
      clear();
    },
    true,
  );
  window.addEventListener("unhandledrejection", () => {
    window.blackboxSiteOpening?.finish({ status: "partial" });
    clear();
  });
  window.addEventListener("pagehide", () => {
    window.blackboxSiteOpening?.finish({ status: "skipped" });
    clear();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      resumePreparation();
      write(navigationKey, null);
      clear();
    }
  });
  motion.addEventListener("change", () => {
    if (motion.matches && mode !== "loading") clear();
  });
})();
