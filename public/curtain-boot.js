// Generated from src/client/curtain-boot.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/curtain/scene.js
  var createCurtainScene = (texture) => {
    const scene = document.createElement("div");
    scene.className = "curtain-scene";
    scene.setAttribute("aria-hidden", "true");
    for (const side of ["left", "right"]) {
      const wing = document.createElement("div");
      wing.className = `curtain-wing curtain-wing-${side}`;
      for (let index = 0; index < 8; index++) {
        const fold = document.createElement("span");
        fold.className = "curtain-fold";
        wing.append(fold);
      }
      if (texture) {
        const cloth = document.createElement("img");
        cloth.className = "curtain-cloth";
        cloth.alt = "";
        cloth.draggable = false;
        cloth.decoding = "async";
        cloth.fetchPriority = "high";
        cloth.addEventListener("error", () => cloth.remove(), { once: true });
        cloth.src = texture;
        wing.append(cloth);
      }
      scene.append(wing);
    }
    const shade = document.createElement("div");
    shade.className = "curtain-atmosphere";
    scene.append(shade);
    return scene;
  };

  // src/client/curtain-boot.js
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
      } catch {
      }
    };
    let incoming;
    try {
      incoming = JSON.parse(read(navigationKey));
    } catch {
    }
    write(navigationKey, null);
    const navigationType = performance.getEntriesByType("navigation")[0]?.type;
    const history = navigationType === "back_forward";
    let internalReferrer = false;
    try {
      internalReferrer = navigationType !== "reload" && new URL(document.referrer).origin === location.origin;
    } catch {
    }
    const arriving = Boolean(
      internalReferrer || incoming?.to === location.href && Date.now() - incoming.at >= 0 && Date.now() - incoming.at < 3e5 && !history
    );
    window.blackboxCurtainArrival = arriving;
    const entered = read(enteredKey) === "entered";
    if (enabled) write(enteredKey, "entered");
    let overlay, mode, cleanupTimer;
    const state = window.blackboxCurtain = { active: false };
    const recovery = (message) => {
      if (!document.body) return;
      document.querySelector(".curtain-recovery")?.remove();
      const notice = document.createElement("p");
      notice.className = "curtain-recovery";
      notice.setAttribute("role", "status");
      notice.textContent = message;
      document.body.append(notice);
      setTimeout(() => notice.remove(), 6e3);
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
      overlay.close?.();
      if (overlay.tagName === "DIALOG") overlay.setAttribute("open", "");
      overlay.className = "blackbox-curtain is-revealing";
      overlay.setAttribute("aria-hidden", "true");
      overlay.querySelector(".curtain-panel").inert = true;
      overlay.addEventListener("animationend", (event) => {
        if (event.animationName === "curtain-reveal-depth") clear();
      });
      const duration = Math.min(
        2e3,
        Math.max(0, parseFloat(getComputedStyle(overlay).getPropertyValue("--curtain-reveal-duration")) || 900)
      );
      cleanupTimer = setTimeout(clear, duration + 120);
    };
    const mount = () => {
      if (overlay) return overlay;
      if (!getComputedStyle(document.documentElement).getPropertyValue("--blackbox-curtain-ready")) return null;
      const node = document.createElement("dialog");
      node.id = "site-opening-curtain";
      node.className = "blackbox-curtain is-loading";
      node.setAttribute("aria-label", "\u6B63\u5728\u52A0\u8F7D\u9ED1\u5323\u5B50");
      node.innerHTML = '<div class="curtain-panel"><p class="curtain-brand" aria-hidden="true">\u9ED1\u5323\u5B50<span>\u8BDD\u5267\u961F</span></p><p class="curtain-label" role="status" aria-live="polite"></p><p class="curtain-detail"></p></div>';
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
    const shouldLoad = version && !entered && !arriving && !history && navigator.onLine !== false && !connection?.saveData && !/(^|-)2g$/.test(connection?.effectiveType || "") && read(storageKey) !== "ready" && read(dismissalKey) !== "dismissed";
    let openingObserver, openingDeadline;
    if (shouldLoad) {
      const opening = window.blackboxSiteOpening = {
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
                failed: opening.failed
              }
            })
          );
          if (["partial", "timeout"].includes(opening.status)) recovery("\u90E8\u5206\u8D44\u6E90\u5C1A\u672A\u5C31\u7EEA\uFF0C\u5DF2\u663E\u793A\u9875\u9762\uFF0C\u53EF\u7EE7\u7EED\u6D4F\u89C8\u3002");
        }
      };
      const render = () => {
        if (mode !== "loading") return;
        const meter = overlay.querySelector("progress");
        if (opening.total && !opening.discovering) {
          meter.max = opening.total;
          meter.value = opening.completed;
        } else meter.removeAttribute("value");
        const failures = opening.failed ? ` \xB7 ${opening.failed} \u9879\u6682\u4E0D\u53EF\u7528` : "";
        overlay.querySelector(".curtain-detail").textContent = opening.discovering ? `\u6B63\u5728\u83B7\u53D6\u9875\u9762\u4E0E\u8D44\u6E90\u6E05\u5355${opening.completed ? ` \xB7 \u5DF2\u5C31\u7EEA ${opening.completed} \u9879` : ""}${failures}` : `${opening.completed} / ${opening.total} \u9879\u8D44\u6E90\u5DF2\u5C31\u7EEA${failures}`;
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
        node.querySelector(".curtain-label").textContent = "\u6B63\u5728\u52A0\u8F7D\u9ED1\u5323\u5B50";
        const meter = document.createElement("progress");
        meter.className = "curtain-meter";
        meter.setAttribute("aria-label", "\u5DF2\u5C31\u7EEA\u8D44\u6E90\u6570\u91CF");
        node.querySelector(".curtain-detail").before(meter);
        render();
      };
      openingDeadline = setTimeout(() => opening.finish({ status: "timeout" }), 1e4);
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
    const eligible = (url) => url.origin === location.origin && /^\/(?:productions(?:\/\d+)?|resources|members(?:\/\d+)?|thanks|help|announcements(?:\/\d+)?)?$/.test(
      url.pathname
    ) && !url.searchParams.has("stage-preview");
    window.addEventListener("click", (event) => {
      if (!enabled || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.target && link.target !== "_self") return;
      const url = new URL(link.href, location.href);
      if (!eligible(url) || url.pathname === location.pathname && url.search === location.search) return;
      navigating = true;
      write(navigationKey, JSON.stringify({ to: url.href, at: Date.now() }));
      document.dispatchEvent(new CustomEvent("blackbox:navigation-start"));
    });
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
      true
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
})();
