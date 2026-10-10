(() => {
  const root = document.documentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const key = "blackbox-navigation-light";
  if (new URLSearchParams(location.search).has("stage-preview")) return;
  // History, reduced motion or a superseding navigation can skip a native snapshot.
  // Its ready promise then rejects; the normal document and CSS entrance still work.
  for (const event of ["pageswap", "pagereveal"])
    window.addEventListener(event, ({ viewTransition }) => viewTransition?.ready.catch(() => {}));
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
  const elapsed = Date.now() - incoming?.at;
  const arriving =
    incoming?.to === location.href &&
    elapsed >= 0 &&
    elapsed < 30000 &&
    performance.getEntriesByType("navigation")[0]?.type === "navigate";
  // Run in the head so a new document never paints fully, then hides for its entrance.
  if (arriving && !motion.matches) root.classList.add("scene-navigation-in");
  const entryDeadline = setTimeout(() => root.classList.remove("scene-navigation-in"), 1800);
  const setup = () => {
    const header = document.querySelector(".design-public .top");
    const main = document.getElementById("main-content");
    if (!header || !main) {
      root.classList.remove("scene-navigation-in");
      return;
    }
    clearTimeout(entryDeadline);
    const compact = matchMedia("(max-width: 900px)");
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
    let waitTimer, slowTimer, entryTimer;
    const prefetch = window.blackboxNavigationPrefetch;
    const spot = document.createElement("span");
    spot.className = "nav-followspot";
    spot.setAttribute("aria-hidden", "true");
    const status = document.createElement("div");
    status.className = "scene-navigation-assist";
    status.hidden = true;
    const notice = document.createElement("span");
    notice.setAttribute("role", "status");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "留在此页";
    cancel.setAttribute("aria-label", "取消打开页面");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "重试";
    retry.hidden = true;
    status.append(notice, retry, cancel);
    document.body.append(status);
    document.body.classList.add("nav-light-enabled");

    const position = () => {
      const href = sectionHref[selected];
      const desktop = header.querySelector("#main-navigation");
      const bottom = document.querySelector(".mobile-nav");
      const inMenu = compact.matches && desktop?.classList.contains("is-open");
      const host = compact.matches && !inMenu && selected !== "thanks" ? bottom || header : header;
      if (spot.parentElement !== host) host.append(spot);
      const links = host === bottom ? bottom : desktop;
      const target = [...(links?.querySelectorAll("a[href]") || [])].find(
        (link) => link.pathname === href && link.getClientRects().length,
      );
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
      const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
      const bottomHeight = bottom?.getClientRects().length ? bottom.getBoundingClientRect().height : 0;
      root.style.setProperty("--scene-top", `${headerBottom}px`);
      root.style.setProperty("--scene-bottom", `${bottomHeight}px`);
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
      clearTimeout(entryTimer);
      root.classList.remove(
        "scene-navigation-out",
        "scene-navigation-in",
        "scene-navigation-waiting",
        "scene-reveal-ready",
      );
      main.removeAttribute("aria-busy");
      status.classList.remove("is-slow");
      status.hidden = true;
      retry.hidden = true;
      main.querySelectorAll(".scene-reveal-title,.scene-reveal-piece").forEach((el) => {
        el.classList.remove("scene-reveal-title", "scene-reveal-piece");
        el.style.removeProperty("--scene-order");
      });
      pending = null;
    };
    const cancelNavigation = () => {
      if (!pending) return;
      const origin = pending.link;
      if (pending.native) window.stop();
      prefetch?.cancel();
      clean();
      store(null);
      selected = sectionOf(new URL(location.href));
      position();
      origin?.focus({ preventScroll: true });
      prefetch?.resume();
    };
    cancel.addEventListener("click", cancelNavigation);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && pending) cancelNavigation();
    });
    markCurrent();
    // Resume the same light movement if the next document arrives before it ends.
    const remaining = arriving ? 620 - (Date.now() - (incoming.lightAt || incoming.at)) : 0;
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
    if (navigation)
      new MutationObserver(position).observe(navigation, { attributes: true, attributeFilter: ["class"] });
    compact.addEventListener("change", position);
    window.addEventListener("resize", position, { passive: true });
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

    // Opt-in lives in the external stylesheet so the site's strict CSP permits it.
    window.addEventListener("pageswap", (event) => {
      if (!pending || motion.matches) event.viewTransition?.skipTransition();
      else root.classList.add("scene-navigation-out");
    });
    const commit = (navigation) => {
      if (pending !== navigation) return;
      navigation.native = true;
      // The native document loads from the short-lived browser cache when available.
      // No HTML injection, synthetic history or script re-execution.
      store({ to: navigation.to, from: navigation.from, at: Date.now(), lightAt: navigation.at });
      location.assign(navigation.to);
    };
    const requestPage = async (navigation, refresh = false) => {
      try {
        const data = await prefetch.prepare(navigation.to, true, refresh);
        if (pending !== navigation) return;
        // A backdrop/CSS head start is bounded; one slow picture never holds the text hostage.
        await Promise.race([prefetch.warmAssets(data, true), new Promise((resolve) => setTimeout(resolve, 300))]);
        commit(navigation);
      } catch {
        if (pending !== navigation) return;
        clearTimeout(waitTimer);
        clearTimeout(slowTimer);
        root.classList.remove("scene-navigation-waiting");
        main.removeAttribute("aria-busy");
        notice.textContent = navigator.onLine ? "暂时无法打开页面，请重试" : "网络已断开，连接后可重试";
        status.classList.add("is-slow");
        retry.hidden = false;
        store(null);
      }
    };
    const begin = (link, url) => {
      if (pending?.native) window.stop();
      prefetch?.cancel(url.origin + url.pathname);
      clean();
      const navigation = { link, to: url.href, from: sectionOf(new URL(location.href)), native: false, at: Date.now() };
      pending = navigation;
      selected = sectionOf(url);
      position();
      main.setAttribute("aria-busy", "true");
      notice.textContent =
        "正在打开" +
        ({ home: "首页", productions: "作品与资料", members: "队员与剧团", thanks: "鸣谢" }[selected] || "页面");
      status.hidden = false;
      waitTimer = setTimeout(() => root.classList.add("scene-navigation-waiting"), 450);
      slowTimer = setTimeout(() => {
        notice.textContent = "网络较慢，页面仍在加载";
        status.classList.add("is-slow");
        retry.hidden = false;
      }, 3000);
      return navigation;
    };
    retry.addEventListener("click", () => {
      if (!pending) return;
      const { link, to } = pending;
      prefetch?.cancel();
      const navigation = begin(link, new URL(to));
      if (prefetch?.eligible(to)) requestPage(navigation, true);
      else commit(navigation);
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
        url.searchParams.has("stage-preview")
      )
        return;
      // An anchor on the still-visible page can cancel a slow destination too.
      if (url.pathname === location.pathname) {
        cancelNavigation();
        return;
      }
      const from = sectionOf(new URL(location.href));
      const navigation = begin(link, url);
      if (prefetch?.eligible(url.href)) {
        event.preventDefault();
        requestPage(navigation);
      } else {
        // Signed-in, filtered and unsupported requests keep their native semantics.
        navigation.native = true;
        store({ to: url.href, from, at: Date.now() });
      }
    });
    // Keep the outgoing lighting in the browser snapshot; clear it on BFCache restore.
    window.addEventListener("pagehide", () => {
      clearTimeout(waitTimer);
      clearTimeout(slowTimer);
      clearTimeout(entryTimer);
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        clean();
        document
          .querySelectorAll(".scene-reveal-title,.scene-reveal-piece,.scene-reveal-picture,.scene-image-pending")
          .forEach((el) =>
            el.classList.remove(
              "scene-reveal-title",
              "scene-reveal-piece",
              "scene-reveal-picture",
              "scene-image-pending",
            ),
          );
        store(null);
        selected = sectionOf(new URL(location.href));
        markCurrent();
        position();
      }
    });
    motion.addEventListener("change", () => {
      if (motion.matches) root.classList.remove("scene-navigation-in");
    });
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top < innerHeight + 60 && box.bottom > 0;
    };
    const entering = arriving && !motion.matches;
    // Eagerly load only visible content photos. Below-fold galleries keep native lazy loading.
    [...main.querySelectorAll("img")]
      .filter((img) => !img.closest(".theatre-art") && visible(img))
      .slice(0, 8)
      .forEach((img) => {
        img.loading = "eager";
        img.fetchPriority = "high";
        if (!entering) return;
        img.classList.add("scene-image-pending");
        const reveal = () => {
          img.classList.remove("scene-image-pending");
          if (img.naturalWidth && !motion.matches) {
            img.classList.add("scene-reveal-picture");
            setTimeout(() => img.classList.remove("scene-reveal-picture"), 800);
          }
        };
        if (img.complete)
          img
            .decode()
            .catch(() => {})
            .then(reveal);
        else {
          img.addEventListener(
            "load",
            () =>
              img
                .decode()
                .catch(() => {})
                .then(reveal),
            { once: true },
          );
          img.addEventListener("error", reveal, { once: true });
        }
      });
    if (entering) {
      const container =
        main.querySelector(".stage-scene:not([hidden])") || main.querySelector(".navigation-stage-content") || main;
      const groups = [...container.children].filter(
        (el) => !["SCRIPT", "STYLE", "LINK"].includes(el.tagName) && el.getClientRects().length,
      );
      groups.slice(0, 8).forEach((el, i) => {
        el.style.setProperty("--scene-order", String(Math.min(i, 5)));
        el.classList.add("scene-reveal-piece");
      });
      [...container.querySelectorAll("h1,h2")]
        .filter(visible)
        .slice(0, 12)
        .forEach((el) => el.classList.add("scene-reveal-title"));
      root.classList.add("scene-reveal-ready");
      entryTimer = setTimeout(() => {
        root.classList.remove("scene-navigation-in", "scene-reveal-ready");
        groups.forEach((el) => {
          el.style.removeProperty("--scene-order");
          el.classList.remove("scene-reveal-piece");
        });
        container.querySelectorAll(".scene-reveal-title").forEach((el) => el.classList.remove("scene-reveal-title"));
      }, 1100);
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
