/* Progressive enhancement: without JS all three sections and ordinary links remain usable. */
(() => {
  const attach = () => {
    const profile = document.querySelector(".member-dossier");
    if (!profile || profile.dataset.tabsReady) return;
    profile.dataset.tabsReady = "true";
    const nav = profile.querySelector(".dossier-tabs");
    const tabs = [...nav.querySelectorAll("a")];
    nav.setAttribute("role", "tablist");
    const panels = profile.querySelector(".dossier-panels");
    const cue = profile.querySelector(".dossier-scroll-cue");
    const updateCue = () => {
      cue.hidden = panels.scrollHeight - panels.clientHeight - panels.scrollTop < 8;
    };
    panels.addEventListener("scroll", updateCue, { passive: true });
    const observer = new ResizeObserver(updateCue);
    observer.observe(panels);
    const select = (tab, focus = false) => {
      for (const item of tabs) {
        const active = item === tab;
        item.setAttribute("aria-selected", String(active));
        item.tabIndex = active ? 0 : -1;
        profile.querySelector(item.hash).hidden = !active;
      }
      panels.scrollTop = 0;
      requestAnimationFrame(updateCue);
      if (focus) tab.focus();
    };
    for (const tab of tabs) {
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", tab.hash.slice(1));
      const panel = profile.querySelector(tab.hash);
      panel.setAttribute("role", "tabpanel");
      panel.tabIndex = 0;
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        select(tab);
        history.replaceState(history.state, "", tab.hash);
      });
      tab.addEventListener("keydown", (event) => {
        let index = tabs.indexOf(tab);
        if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") index = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = tabs.length - 1;
        else return;
        event.preventDefault();
        tabs[index].click();
        tabs[index].focus();
      });
    }
    select(tabs.find((tab) => tab.hash === location.hash) || tabs[1]);
    const hashChange = () => select(tabs.find((tab) => tab.hash === location.hash) || tabs[1]);
    window.addEventListener("hashchange", hashChange);
    profile.addEventListener(
      "profile:detach",
      () => {
        window.removeEventListener("hashchange", hashChange);
        observer.disconnect();
      },
      { once: true },
    );
    const photo = profile.querySelector("[data-dossier-photo]");
    photo?.addEventListener("click", (event) => {
      event.preventDefault();
      const dialog = document.createElement("dialog");
      dialog.className = "dossier-photo-dialog";
      dialog.setAttribute("aria-label", "队员照片");
      const close = document.createElement("button");
      close.textContent = "关闭照片";
      const img = document.createElement("img");
      img.src = photo.href;
      img.alt = photo.querySelector("img").alt;
      dialog.append(close, img);
      document.body.append(dialog);
      close.onclick = () => dialog.close();
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          photo.focus();
        },
        { once: true },
      );
      dialog.showModal();
    });
  };
  attach();
  document.addEventListener("profile:updated", attach);
  // Store only the current results page position; no member data is persisted.
  if (location.pathname === "/members") {
    const params = new URLSearchParams(location.search);
    if (!params.get("page")) params.set("page", "1");
    for (const name of ["q", "year"]) if (!params.get(name)) params.delete(name);
    params.sort();
    const key = "member-results:" + params;
    const restore = () => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (!saved) return;
        requestAnimationFrame(() => {
          window.scrollTo(0, saved.window || 0);
          const main = document.querySelector("main");
          if (main) main.scrollTop = saved.main || 0;
        });
      } catch {
        /* Storage may be disabled. Navigation still works. */
      }
    };
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".member-card-link")) return;
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({ window: scrollY, main: document.querySelector("main")?.scrollTop || 0 }),
        );
      } catch {}
    });
    restore();
    window.addEventListener("pageshow", restore);
  }
})();
