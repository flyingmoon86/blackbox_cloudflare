// Runs before body parsing; a delayed experience script must not expose the stage.
(() => {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  if (
    motion.matches ||
    location.search ||
    location.hash ||
    performance.getEntriesByType("navigation")[0]?.type === "back_forward"
  )
    return;
  const root = document.documentElement;
  const release = () => {
    root.classList.remove("curtain-pending");
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
  window.blackboxCurtainBoot = { release, cancelled: false };
  root.classList.add("curtain-pending");
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", dismiss);
  window.addEventListener("error", onFailure, true);
  window.addEventListener("pagehide", dismiss);
  motion.addEventListener("change", dismiss);
  // Slow connections stay covered; only explicit skip or script failure restores the page.
})();
