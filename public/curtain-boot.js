// One renderer for navigation, early boot and opening: no external media or work data.
window.blackboxCreateCloth = () => {
  const svgNS = "http://www.w3.org/2000/svg";
  const cloth = document.createElementNS(svgNS, "svg");
  cloth.setAttribute("class", "curtain-cloth");
  cloth.setAttribute("viewBox", "0 0 1200 1000");
  cloth.setAttribute("preserveAspectRatio", "none");
  cloth.setAttribute("aria-hidden", "true");
  cloth.innerHTML = `<defs>
    <linearGradient id="curtain-fold"><stop stop-color="#210508"/><stop offset=".13" stop-color="#4e0b12"/><stop offset=".32" stop-color="#901d29"/><stop offset=".48" stop-color="#b93640"/><stop offset=".64" stop-color="#951d29"/><stop offset=".85" stop-color="#4b0911"/><stop offset="1" stop-color="#210508"/></linearGradient>
    <linearGradient id="curtain-weight" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".54"/><stop offset=".16" stop-color="#ff9b8e" stop-opacity=".12"/><stop offset=".55" stop-color="#530815" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity=".58"/></linearGradient>
    <filter id="curtain-nap" x="-3%" y="-1%" width="106%" height="102%">
      <feTurbulence type="fractalNoise" baseFrequency="16 .42" numOctaves="2" seed="19" stitchTiles="stitch" result="fiber"/>
      <feColorMatrix in="fiber" type="matrix" values="0 0 0 0 .82 0 0 0 0 .05 0 0 0 0 .08 0 0 0 .16 0" result="redFiber"/>
      <feBlend in="SourceGraphic" in2="redFiber" mode="screen" result="velvet"/>
      <feComposite in="velvet" in2="SourceGraphic" operator="in" result="clippedVelvet"/>
      <feDisplacementMap in="clippedVelvet" in2="fiber" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>`;
  const folds = [];
  const foldCount = matchMedia("(max-width:600px)").matches ? 6 : 10;
  for (let side = 0; side < 2; side++) {
    const group = document.createElementNS(svgNS, "g");
    if (side) group.setAttribute("transform", "translate(1200 0) scale(-1 1)");
    for (let index = 0; index < foldCount; index++) {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("fill", "url(#curtain-fold)");
      path.setAttribute("filter", "url(#curtain-nap)");
      const shade = document.createElementNS(svgNS, "path");
      shade.setAttribute("fill", "url(#curtain-weight)");
      group.append(path, shade);
      folds.push({ path, shade, index, side });
    }
    cloth.append(group);
  }
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const drawCloth = (progress) => {
    for (const { path, shade, index, side } of folds) {
      const edge = (i, depth) => {
        const delayed = clamp((progress - depth * 0.045) / (1 - depth * 0.045));
        const lead = 604 - 760 * delayed;
        const rest = i * (604 / foldCount) + (i > 0 && i < foldCount ? Math.sin(i * 1.4) * 6 : 0);
        const packed = 11 + Math.sin(i * 1.7) * 1.2;
        const x = Math.min(rest, lead - (foldCount - i) * packed);
        const slack = Math.sin(Math.PI * delayed);
        const drape = x + Math.sin(i * 1.3 + side * 0.6 + depth * 2) * (3 + 5 * slack) * depth + 12 * slack * depth;
        return i === 0 ? Math.min(-8, drape) : drape;
      };
      const a = [edge(index, 0), edge(index, 0.35), edge(index, 0.7), edge(index, 1)];
      const b = [edge(index + 1, 0), edge(index + 1, 0.35), edge(index + 1, 0.7), edge(index + 1, 1)];
      const d = `M ${a[0]} -8 C ${a[1]} 260 ${a[2]} 700 ${a[3]} 1010 L ${b[3] + 1} 1010 C ${b[2] + 1} 700 ${b[1] + 1} 260 ${b[0] + 1} -8 Z`;
      path.setAttribute("d", d);
      shade.setAttribute("d", d);
    }
  };
  drawCloth(0);
  return { cloth, drawCloth };
};

// Only curtain resources are prepared up front. Work URLs are never prefetched.
(() => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let navigation;
  let nextFrame;
  let slowNotice;
  let originLink;
  const clearNavigation = () => {
    cancelAnimationFrame(nextFrame);
    clearTimeout(slowNotice);
    navigation?.close();
    navigation?.remove();
    navigation = null;
  };
  const cancelNavigation = () => {
    // The current document is still active: stop its pending native navigation.
    window.stop();
    clearNavigation();
    originLink?.focus({ preventScroll: true });
  };
  window.addEventListener("pagehide", clearNavigation);
  window.addEventListener("pageshow", clearNavigation);
  motion.addEventListener("change", clearNavigation);
  document.addEventListener("click", (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self") || motion.matches) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      !/^\/productions\/\d+$/.test(url.pathname) ||
      url.search ||
      url.hash ||
      url.href === location.href
    )
      return;
    if (!HTMLDialogElement.prototype.showModal) return;
    if (!getComputedStyle(document.documentElement).getPropertyValue("--curtain-closed")) return;
    if (navigation) return;
    const dialog = document.createElement("dialog");
    dialog.id = "work-navigation-curtain";
    dialog.className = "curtain-navigation";
    dialog.setAttribute("aria-label", "正在打开作品");
    dialog.innerHTML =
      '<div class="curtain-navigation-status"><span class="curtain-navigation-bell" aria-hidden="true">🔔</span><p role="status">正在获取作品页面</p><div class="curtain-navigation-meter" role="progressbar" aria-label="等待作品页面响应"></div><button type="button" class="curtain-navigation-cancel">取消打开</button></div>';
    dialog.prepend(window.blackboxCreateCloth().cloth);
    document.body.append(dialog);
    try {
      dialog.showModal();
    } catch {
      dialog.remove();
      return; // Native links remain usable when the enhancement is unavailable.
    }
    event.preventDefault();
    navigation = dialog;
    originLink = link;
    dialog.addEventListener("cancel", (cancel) => {
      cancel.preventDefault();
      cancelNavigation();
    });
    dialog.querySelector("button").onclick = cancelNavigation;
    slowNotice = setTimeout(() => {
      if (navigation === dialog)
        dialog.querySelector('[role="status"]').textContent = "仍在等待作品页面响应，可取消后重试";
    }, 8000);
    // Allow one closed-curtain paint, not a simulated loading delay. The browser
    // performs one normal document request; destination JS handles actual media.
    nextFrame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => {
        if (navigation === dialog) location.assign(url.href);
      });
    });
  });
  // Destination boot precedes the ordinary styles and dynamic theme request.
  if (
    !document.currentScript?.hasAttribute("data-work-curtain") ||
    motion.matches ||
    location.search ||
    location.hash ||
    performance.getEntriesByType("navigation")[0]?.type === "back_forward"
  )
    return;
  const root = document.documentElement;
  const fabric = window.blackboxCreateCloth();
  const earlyCloth = document.createElement("div");
  earlyCloth.className = "curtain-boot-cloth";
  earlyCloth.setAttribute("aria-hidden", "true");
  earlyCloth.append(fabric.cloth);
  root.append(earlyCloth);
  const release = () => {
    root.classList.remove("curtain-pending");
    earlyCloth.remove();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("click", dismiss);
    window.removeEventListener("error", onFailure, true);
    window.removeEventListener("pagehide", dismiss);
    motion.removeEventListener("change", dismiss);
  };
  const dismiss = () => {
    window.blackboxCurtainBoot.cancelled = true;
    release();
    const restoreCover = () => {
      document.querySelectorAll("img[data-curtain-src]").forEach((cover) => {
        if (!cover.getAttribute("src")) cover.src = cover.dataset.curtainSrc;
        cover.hidden = false;
      });
    };
    restoreCover();
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restoreCover, { once: true });
  };
  const onKey = (event) => {
    if (event.key === "Escape") dismiss();
  };
  const onFailure = (event) => {
    if (event.target instanceof HTMLScriptElement || event.error) dismiss();
  };
  window.blackboxCurtainBoot = { release, cancelled: false, fabric };
  root.classList.add("curtain-pending");
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", dismiss);
  window.addEventListener("error", onFailure, true);
  window.addEventListener("pagehide", dismiss);
  motion.addEventListener("change", dismiss);
  // Slow connections stay covered; only explicit skip or script failure restores the page.
})();
