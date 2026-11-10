// Results-page state belongs to each mounted page, including cached navigation.
window.blackboxPages.register("member-results", (root, scope) => {
  if (!root.querySelector(".member-grid") || location.pathname !== "/members") return;
  const params = new URLSearchParams(location.search);
  if (!params.get("page")) params.set("page", "1");
  for (const name of ["q", "year"]) if (!params.get(name)) params.delete(name);
  params.sort();
  const key = "member-results:" + params;
  let frame;
  const restore = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (!saved) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!root.isConnected || scope.signal.aborted) return;
        window.scrollTo(0, saved.window || 0);
        root.scrollTop = saved.main || 0;
      });
    } catch {
      /* Storage may be disabled. Ordinary navigation still works. */
    }
  };
  scope.listen(root, "click", (event) => {
    if (!event.target.closest(".member-card-link")) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ window: scrollY, main: root.scrollTop }));
    } catch {}
  });
  scope.listen(window, "pageshow", restore);
  scope.dispose(() => cancelAnimationFrame(frame));
  restore();
});
