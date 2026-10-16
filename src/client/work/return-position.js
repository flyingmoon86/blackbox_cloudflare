export function restoreWorkReturn(cards) {
  const storageKey = "blackbox-work-return:v1";
  const current = location.pathname + location.search + location.hash;
  const readReturn = () => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw || raw.length > 4096) return null;
      const value = JSON.parse(raw);
      const list = new URL(value.url, location.origin);
      if (
        list.origin !== location.origin ||
        list.pathname !== "/productions" ||
        !/^\/productions\/\d+$/.test(value.to) ||
        !Number.isFinite(value.at) ||
        Date.now() - value.at < 0 ||
        Date.now() - value.at > 30 * 60 * 1000 ||
        !Number.isFinite(value.y) ||
        value.y < 0
      )
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
      // Restricted storage leaves native links and history restoration untouched.
    }
  };
  const saved = readReturn();
  const back = document.querySelector("[data-work-return]");
  if (back && saved?.to === location.pathname) back.href = saved.url;
  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target ||
      link.hasAttribute("download")
    )
      return;
    const destination = new URL(link.href, location.href);
    if (destination.origin !== location.origin) return;
    if (
      location.pathname === "/productions" &&
      link.closest("[data-work-card]") &&
      /^\/productions\/\d+$/.test(destination.pathname)
    ) {
      writeReturn({
        url: current,
        to: destination.pathname,
        focus: destination.pathname + destination.search + destination.hash,
        y: window.scrollY,
        at: Date.now(),
        explicit: false,
      });
    } else if (link === back && saved && saved.to === location.pathname) {
      writeReturn({ ...saved, explicit: true, at: Date.now() });
    }
  });

  if (location.pathname !== "/productions" || !cards.length) return;
  let interacted = false;
  let restored = false;
  for (const event of ["pointerdown", "touchstart", "wheel", "keydown"])
    window.addEventListener(event, () => (interacted = true), { passive: true });
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
      const link = cards
        .flatMap((card) => [...card.querySelectorAll("a[href]")])
        .find((candidate) => {
          const url = new URL(candidate.href, location.href);
          return url.pathname + url.search + url.hash === pending.focus;
        });
      // History/BFCache owns scroll restoration. Only the explicit return link
      // needs its saved position; focus never scrolls a restored page.
      if (!historyNavigation) window.scrollTo({ top: pending.y, behavior: "instant" });
      if (
        link &&
        (!historyNavigation ||
          document.activeElement === document.body ||
          document.activeElement === document.documentElement)
      )
        link.focus({ preventScroll: true });
    });
  };
  // Deferred script + DOMContentLoaded means the list and its CSS are ready.
  // Do not wait for unrelated backgrounds to finish before restoring focus.
  document.addEventListener("DOMContentLoaded", () => restoreReturn());
  window.addEventListener("pageshow", (event) => restoreReturn(event.persisted));
}
