// Route commits are synchronous: no fetch, timer, animation or prefetch await.
export function installRouter(pages, assets, canonical) {
  let current = location.pathname;
  let valid = true;
  let accountVersion;
  try {
    accountVersion = localStorage.getItem("blackbox-account-change");
  } catch {}
  // Native history also spans uncached details and BFCache misses. Let the
  // browser restore those entries instead of keeping a document-local map.
  history.scrollRestoration = "auto";
  const commit = (url, back = false) => {
    const page = pages.get(url.pathname);
    if (!valid || !page?.ready || !window.blackboxPages) return false;
    const before = performance.now();
    const previous = document.querySelector("#main-content");
    if (!previous) return false;
    const next = page.main.cloneNode(true);
    try {
      window.blackboxPages.unmount();
      if (!back) history.pushState({}, "", url);
      assets.activate(page.styles);
      for (const name of ["layout-book", "layout-members", "layout-gallery", "archive-page"])
        document.body.classList.toggle(name, page.classes.includes(name));
      document.body.dataset.section = page.section;
      document.title = page.title;
      previous.replaceWith(next);
      document
        .querySelectorAll(".nav-menu.is-open,#main-navigation.is-open")
        .forEach((node) => node.classList.remove("is-open"));
      document.querySelectorAll(".nav-panel").forEach((node) => (node.hidden = true));
      document
        .querySelectorAll(".menu-toggle,.nav-menu-toggle")
        .forEach((node) => node.setAttribute("aria-expanded", "false"));
      document.body.classList.remove("navigation-open");
      window.blackboxPages.mount(next, back ? "history" : "push");
      current = url.pathname;
      next.focus({ preventScroll: true });
      if (!back) window.scrollTo({ left: 0, top: 0, behavior: "instant" });
      if (url.hash && !back) {
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        const anchor = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (anchor && !anchor.closest(".stage-scene")) anchor.scrollIntoView({ behavior: "instant" });
      }
      document.dispatchEvent(
        new CustomEvent("blackbox:page-changed", { detail: { path: current, commitMs: performance.now() - before } }),
      );
      return true;
    } catch {
      // Even a broken enhancement must not trap navigation or leave half a page.
      valid = false;
      location.assign(url.href);
      return true;
    }
  };
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
    const link = event.target.closest?.("a[href]");
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    try {
      if (localStorage.getItem("blackbox-account-change") !== accountVersion) valid = false;
    } catch {}
    const path = canonical(link.href);
    if (!path) return;
    const url = new URL(link.href);
    if (url.pathname === current && url.hash) return;
    if (commit(url)) event.preventDefault();
  });
  window.addEventListener("popstate", () => {
    if (location.pathname === current) return;
    if (!canonical(location.href) || !commit(new URL(location.href), true)) location.reload();
  });
  // Another tab logging in/out invalidates the live public-page controller too.
  window.addEventListener("storage", (event) => {
    if (event.key === "blackbox-account-change") {
      valid = false;
      pages.clear();
    }
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    try {
      if (localStorage.getItem("blackbox-account-change") !== accountVersion) {
        valid = false;
        pages.clear();
      }
    } catch {}
  });
  return {
    navigate: commit,
    invalidate() {
      valid = false;
      pages.clear();
    },
  };
}
