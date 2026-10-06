(() => {
  const header = document.querySelector(".design-public .top");
  const main = document.getElementById("main-content");
  if (!header || !main || new URLSearchParams(location.search).has("stage-preview")) return;
  const root = document.documentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const compact = matchMedia("(max-width: 900px)");
  const key = "blackbox-navigation-light";
  const sectionPaths = ["/", "/productions", "/resources", "/members", "/thanks"];
  const sectionOf = (url) => {
    if (url.pathname === "/" && ["#about", "#contact"].includes(url.hash)) return "members";
    if (/^\/(productions|resources)(\/|$)/.test(url.pathname)) return "productions";
    if (/^\/members(\/|$)/.test(url.pathname)) return "members";
    if (/^\/(thanks|feedback)(\/|$)/.test(url.pathname)) return "thanks";
    return url.pathname === "/" ? "home" : "";
  };
  const sectionHref = { home: "/", productions: "/productions", members: "/members", thanks: "/thanks" };
  let selected = sectionOf(new URL(location.href));
  let pending = null;
  let waitTimer, slowTimer;
  const spot = document.createElement("span");
  spot.className = "nav-followspot";
  spot.setAttribute("aria-hidden", "true");
  const status = document.createElement("div");
  status.className = "nav-light-status";
  status.hidden = true;
  const notice = document.createElement("span");
  notice.setAttribute("role", "status");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "取消";
  cancel.setAttribute("aria-label", "取消打开页面");
  status.append(notice, cancel);
  document.body.classList.add("nav-light-enabled");
  const store = (value) => {
    try {
      value ? sessionStorage.setItem(key, JSON.stringify(value)) : sessionStorage.removeItem(key);
    } catch {}
  };
  let incoming;
  try {
    incoming = JSON.parse(sessionStorage.getItem(key));
  } catch {}
  store(null);

  const position = () => {
    const href = sectionHref[selected];
    const desktop = header.querySelector("#main-navigation");
    const bottom = document.querySelector(".mobile-nav");
    const inMenu = compact.matches && desktop?.classList.contains("is-open");
    const host = compact.matches && !inMenu && selected !== "thanks" ? bottom || header : header;
    if (spot.parentElement !== host) host.append(spot, status);
    const target = (host === bottom ? bottom : desktop)?.querySelector(`a[href="${href}"]`);
    const menuFallback = compact.matches && !inMenu && selected === "thanks";
    const anchor = menuFallback ? header.querySelector(".menu-toggle") : target;
    spot.classList.toggle("is-mobile-marker", menuFallback);
    document
      .querySelectorAll(".top a.is-spotlit,.mobile-nav a.is-spotlit")
      .forEach((a) => a.classList.remove("is-spotlit"));
    if (!selected || !anchor || !anchor.getClientRects().length) {
      spot.classList.remove("is-positioned");
      return;
    }
    const bounds = host.getBoundingClientRect(),
      box = anchor.getBoundingClientRect();
    const center = box.left + box.width / 2 - bounds.left;
    spot.style.setProperty(
      "--spot-x",
      `${Math.max(0, Math.min(bounds.width - spot.offsetWidth, center - spot.offsetWidth / 2))}px`,
    );
    spot.style.top = `${Math.max(0, box.top - bounds.top - 8)}px`;
    status.style.setProperty("--status-x", `${center}px`);
    spot.classList.add("is-positioned");
    target?.classList.add("is-spotlit");
  };
  const markCurrent = () => {
    const active = sectionOf(new URL(location.href));
    header.querySelectorAll("#main-navigation > a, .nav-menu > a").forEach((a) => {
      if (a.getAttribute("href") === sectionHref[active]) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  };
  const clean = () => {
    clearTimeout(waitTimer);
    clearTimeout(slowTimer);
    root.classList.remove("scene-navigation-out");
    main.removeAttribute("aria-busy");
    spot.classList.remove("is-waiting");
    status.hidden = true;
    pending = null;
  };
  const cancelNavigation = () => {
    if (!pending) return;
    const origin = pending.link;
    window.stop();
    clean();
    store(null);
    selected = sectionOf(new URL(location.href));
    position();
    origin?.focus({ preventScroll: true });
  };
  cancel.addEventListener("click", cancelNavigation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pending) cancelNavigation();
  });
  markCurrent();
  // Resume the same light movement if the next document arrives before it ends.
  const arriving =
    incoming?.to === location.href &&
    Date.now() - incoming.at < 30000 &&
    performance.getEntriesByType("navigation")[0]?.type === "navigate";
  const remaining = arriving ? 380 - (Date.now() - incoming.at) : 0;
  const destination = selected;
  spot.style.transition = "none";
  if (remaining > 0 && sectionHref[incoming.from] && !motion.matches) selected = incoming.from;
  position();
  spot.getBoundingClientRect();
  requestAnimationFrame(() => {
    spot.style.removeProperty("transition");
    if (remaining > 0) spot.style.transitionDuration = `${remaining}ms`;
    selected = destination;
    position();
    setTimeout(() => spot.style.removeProperty("transition-duration"), Math.max(0, remaining));
  });
  new ResizeObserver(position).observe(header);
  const navigation = header.querySelector("#main-navigation");
  if (navigation) new MutationObserver(position).observe(navigation, { attributes: true, attributeFilter: ["class"] });
  compact.addEventListener("change", position);
  document.fonts.ready.then(position);
  const stage = document.querySelector(".theatre-stage");
  if (stage)
    new MutationObserver(() => {
      if (!pending) {
        selected = sectionOf(new URL(location.href));
        markCurrent();
        position();
      }
    }).observe(stage, { subtree: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("hashchange", () => {
    if (!pending) {
      selected = sectionOf(new URL(location.href));
      markCurrent();
      position();
    }
  });

  // Native navigation makes one document request and preserves forms and history.
  if (sectionPaths.includes(location.pathname)) {
    const optIn = document.createElement("style");
    optIn.textContent = "@view-transition { navigation: auto; }";
    document.head.append(optIn);
  }
  window.addEventListener("pageswap", (event) => {
    if (!pending || motion.matches) event.viewTransition?.skipTransition();
  });
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
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href, location.href);
    if (
      url.origin !== location.origin ||
      !sectionPaths.includes(url.pathname) ||
      url.pathname === location.pathname ||
      url.searchParams.has("stage-preview")
    )
      return;
    clean();
    pending = { link, to: url.href };
    store({ to: url.href, from: selected, at: Date.now() });
    selected = sectionOf(url);
    position();
    root.classList.add("scene-navigation-out");
    main.setAttribute("aria-busy", "true");
    waitTimer = setTimeout(() => {
      notice.textContent = "准备中";
      status.hidden = false;
      spot.classList.add("is-waiting");
    }, 600);
    slowTimer = setTimeout(() => {
      notice.textContent = "稍候片刻";
    }, 8000);
    // No preventDefault: browser navigation can be cancelled or retargeted normally.
  });
  window.addEventListener("pagehide", clean);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      clean();
      store(null);
      selected = sectionOf(new URL(location.href));
      markCurrent();
      position();
    }
  });
  if (arriving && !motion.matches) {
    const container =
      main.querySelector(".stage-scene:not([hidden])") || main.querySelector(".navigation-stage-content") || main;
    const groups = [...container.children].filter(
      (el) => !["SCRIPT", "STYLE", "LINK"].includes(el.tagName) && el.getClientRects().length,
    );
    groups.slice(0, 8).forEach((el, i) => {
      el.style.setProperty("--scene-order", String(Math.min(i, 5)));
      el.classList.add("scene-navigation-enter");
      setTimeout(() => {
        el.classList.remove("scene-navigation-enter");
        el.style.removeProperty("--scene-order");
      }, 1100);
    });
  }
})();
