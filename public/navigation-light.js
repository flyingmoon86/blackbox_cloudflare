// The followspot reflects the current document. Navigation stays entirely native.
(() => {
  if (new URLSearchParams(location.search).has("stage-preview")) return;
  const setup = () => {
    const header = document.querySelector(".design-public .top");
    if (!header) return;
    const compact = matchMedia("(max-width: 900px)");
    const sectionOf = (url) => {
      // Homepage anchors stay within the home section, including its second scene.
      if (/^\/(productions|resources)(\/|$)/.test(url.pathname)) return "productions";
      if (/^\/members(\/|$)/.test(url.pathname)) return "members";
      if (/^\/(thanks|feedback)(\/|$)/.test(url.pathname)) return "thanks";
      return url.pathname === "/" ? "home" : "";
    };
    const sectionHref = { home: "/", productions: "/productions", members: "/members", thanks: "/thanks" };
    const spot = document.createElement("span");
    spot.className = "nav-followspot";
    spot.setAttribute("aria-hidden", "true");
    document.body.classList.add("nav-light-enabled");

    const position = () => {
      const selected = sectionOf(new URL(location.href));
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
      spot.classList.add("is-positioned");
      target?.classList.add("is-spotlit");
    };
    const syncCurrent = () => {
      const active = sectionOf(new URL(location.href));
      header.querySelectorAll("#main-navigation > a, .nav-menu > a").forEach((a) => {
        if (a.getAttribute("href") === sectionHref[active]) a.setAttribute("aria-current", "page");
        else a.removeAttribute("aria-current");
      });
      position();
    };
    syncCurrent();
    new ResizeObserver(position).observe(header);
    const navigation = header.querySelector("#main-navigation");
    if (navigation)
      new MutationObserver(position).observe(navigation, { attributes: true, attributeFilter: ["class"] });
    compact.addEventListener("change", position);
    window.addEventListener("resize", position, { passive: true });
    document.fonts?.ready.then(position);
    window.addEventListener("hashchange", syncCurrent);
    window.addEventListener("pageshow", syncCurrent);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
  else setup();
})();
