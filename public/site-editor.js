(() => {
  const root = document.querySelector("[data-site-editor]");
  if (!root) return;
  const form = root.querySelector("form");
  const tabs = (nav) => {
    const links = [...nav.querySelectorAll("a[aria-controls]")];
    const panels = links.map((link) => document.getElementById(link.getAttribute("aria-controls")));
    nav.setAttribute("role", "tablist");
    links.forEach((link, index) => {
      link.setAttribute("role", "tab");
      panels[index].setAttribute("role", "tabpanel");
    });
    const select = (panel) => {
      panels.forEach((item, index) => {
        const active = item === panel;
        item.hidden = !active;
        links[index].setAttribute("aria-selected", String(active));
        links[index].tabIndex = active ? 0 : -1;
      });
    };
    select(panels[0]);
    nav.addEventListener("keydown", (event) => {
      const index = links.indexOf(event.target);
      if (index < 0) return;
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % links.length;
      if (event.key === "ArrowLeft") next = (index - 1 + links.length) % links.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = links.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      links[next].focus();
      links[next].click();
    });
    return { select, links };
  };
  const main = tabs(root.querySelector("[data-site-nav]"));
  const backgrounds = tabs(root.querySelector("[data-stage-nav]"));
  const reveal = (target) => {
    const panel = target?.closest("[data-site-panel]");
    if (!panel) return;
    main.select(panel);
    const stage = target.closest("[data-stage-editor]");
    if (stage) backgrounds.select(stage);
  };
  const hashTarget = () => {
    try {
      return document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch {
      return null;
    }
  };
  const syncHash = () => reveal(hashTarget());
  for (const link of [...main.links, ...backgrounds.links]) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const hash = link.getAttribute("href");
      if (hash !== location.hash) history.pushState(null, "", hash);
      syncHash();
    });
  }
  window.addEventListener("hashchange", syncHash);
  window.addEventListener("popstate", syncHash);
  syncHash();
  // Keep existing links from the public website useful after their section is hidden.
  if (hashTarget()?.closest("[data-site-panel]")) hashTarget().scrollIntoView({ block: "start" });
  // Hidden sections keep all their form values and upload selections. Reveal the
  // first invalid section before native validation tries to focus its input.
  let handlingInvalid = false;
  form.addEventListener(
    "invalid",
    (event) => {
      if (handlingInvalid) return;
      handlingInvalid = true;
      reveal(event.target);
      const section =
        event.target.closest("[data-stage-editor]") ||
        event.target.closest("[data-site-panel]")?.querySelector("h2[id]");
      if (section) history.replaceState(null, "", `#${section.id}`);
      setTimeout(() => {
        handlingInvalid = false;
      }, 0);
    },
    true,
  );
})();
