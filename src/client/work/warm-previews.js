import { limited, previewURL, connection } from "./policy.js";
export function warmWorkPreviews(cards) {
  // These requests are only public, existing low-resolution covers. They never
  // fetch document HTML, originals, or hold up a user's native navigation.
  const queued = [];
  const attempted = new Set();
  const active = new Set();
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
      const timeout = setTimeout(cancel, 5000);
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
    cards.forEach((card) => observer?.observe(card));
  };
  const observer =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting || !canWarm()) continue;
              enqueue(entry.target);
              observer.unobserve(entry.target);
            }
          },
          { rootMargin: "180px 0px", threshold: 0.05 },
        )
      : null;
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
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : resume()));
  connection?.addEventListener?.("change", () => (limited() ? stop() : resume()));
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
