(() => {
  const nav = document.querySelector("#main-navigation"),
    toggle = document.querySelector(".menu-toggle"),
    header = document.querySelector(".top");
  const menus = [...document.querySelectorAll(".nav-menu")];
  let closeTimer,
    restoringFocus = false;
  const sync = () => {
    menus.forEach((m) => m.querySelector("summary").setAttribute("aria-expanded", String(m.open)));
    document.body.classList.toggle(
      "navigation-open",
      menus.some((m) => m.open),
    );
  };
  const close = () => {
    clearTimeout(closeTimer);
    menus.forEach((m) => (m.open = false));
    sync();
  };
  const open = (m) => {
    clearTimeout(closeTimer);
    menus.forEach((other) => (other.open = other === m));
    sync();
  };
  menus.forEach((m) => {
    const summary = m.querySelector("summary");
    summary.setAttribute("aria-expanded", "false");
    m.addEventListener("toggle", sync);
    m.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch" && matchMedia("(min-width:901px)").matches) open(m);
    });
    m.addEventListener("focusin", () => {
      if (!restoringFocus && matchMedia("(min-width:901px)").matches && summary.matches(":focus-visible")) open(m);
    });
    summary.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        open(m);
        m.querySelector(".nav-panel a")?.focus();
      }
    });
  });
  header?.addEventListener("pointerleave", () => {
    if (matchMedia("(min-width:901px)").matches) closeTimer = setTimeout(close, 160);
  });
  header?.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  header?.addEventListener("focusout", (event) => {
    if (!header.contains(event.relatedTarget)) close();
  });
  header
    ?.querySelectorAll(".desktop-nav>a,.account-link,.brand")
    .forEach((a) => a.addEventListener("pointerenter", close));
  toggle?.addEventListener("click", () => {
    const expanded = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(expanded));
    if (!expanded) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const current = menus.find((m) => m.open);
    close();
    nav?.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    restoringFocus = true;
    current?.querySelector("summary").focus();
    restoringFocus = false;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".top")) close();
  });
  const stage = document.querySelector(".theatre-stage"),
    desktop = matchMedia("(min-width:901px)");
  if (stage) {
    const about = stage.querySelector(".about-columns");
    if (about) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "about-read-more";
      more.textContent = "阅读完整介绍";
      more.hidden = true;
      about.after(more);
      const fit = () => {
        more.hidden = !desktop.matches || about.scrollHeight <= about.clientHeight + 2;
      };
      new ResizeObserver(fit).observe(about);
      more.addEventListener("click", () => {
        const dialog = document.createElement("dialog");
        dialog.className = "about-reading";
        dialog.setAttribute("aria-label", "完整剧团介绍");
        const close = document.createElement("button");
        close.textContent = "关闭 ×";
        close.addEventListener("click", () => dialog.close());
        dialog.append(close);
        about.querySelectorAll("p").forEach((p) => dialog.append(p.cloneNode(true)));
        document.body.append(dialog);
        dialog.addEventListener(
          "close",
          () => {
            dialog.remove();
            more.focus();
          },
          { once: true },
        );
        dialog.showModal();
      });
    }
    const scenes = [...stage.querySelectorAll(".stage-scene")],
      links = [...stage.querySelectorAll(".scene-nav a")];
    let index = location.hash === "#about" || location.hash === "#contact" ? 1 : 0,
      last = 0,
      accumulated = 0,
      lastWheel = 0;
    const show = (next, update = false) => {
      index = Math.max(0, Math.min(scenes.length - 1, next));
      scenes.forEach((scene, i) => {
        scene.hidden = desktop.matches && i !== index;
        scene.inert = desktop.matches && i !== index;
      });
      links.forEach((link, i) => link.setAttribute("aria-current", String(i === index)));
      if (update) history.replaceState(null, "", index ? "#about" : "#welcome");
    };
    const setup = () => {
      stage.classList.toggle("stage-ready", desktop.matches);
      show(index);
    };
    stage.querySelectorAll('a[href="#about"],a[href="#welcome"]').forEach((a) =>
      a.addEventListener("click", (event) => {
        if (!desktop.matches) return;
        event.preventDefault();
        show(a.hash === "#about" ? 1 : 0, true);
      }),
    );
    window.addEventListener("hashchange", () => {
      show(location.hash === "#about" || location.hash === "#contact" ? 1 : 0);
    });
    stage.addEventListener(
      "wheel",
      (event) => {
        if (!desktop.matches || event.ctrlKey || event.target.closest("input,textarea,select,dialog,button")) return;
        if (document.querySelector("dialog[open]") || document.body.classList.contains("navigation-open")) return;
        event.preventDefault();
        const now = performance.now();
        if (now - lastWheel > 180) accumulated = 0;
        const continued = now - lastWheel < 180;
        lastWheel = now;
        if (now - last < 700 || (continued && accumulated === Infinity)) return;
        accumulated += event.deltaY;
        if (Math.abs(accumulated) > 55) {
          show(index + Math.sign(accumulated), true);
          last = now;
          accumulated = Infinity;
        }
      },
      { passive: false },
    );
    document.addEventListener("keydown", (event) => {
      if (
        !desktop.matches ||
        event.defaultPrevented ||
        event.target.closest("input,textarea,select,dialog,summary,button,.top,.mobile-nav") ||
        document.querySelector("dialog[open]")
      )
        return;
      if (["ArrowDown", "PageDown", "ArrowUp", "PageUp"].includes(event.key)) {
        event.preventDefault();
        show(index + (event.key === "ArrowDown" || event.key === "PageDown" ? 1 : -1), true);
      }
    });
    desktop.addEventListener("change", setup);
    setup();
  }
  document.querySelectorAll("[data-contribution-thanks]").forEach((d) => d.showModal());
  const lists = new Set(
    document.querySelectorAll("[data-paginate],main>.card-grid,.production-grid,main>.review-grid,.photo-grid"),
  );
  lists.forEach((list) => {
    if (list.closest("[data-server-paged]") || list.closest(".production-archive")) return;
    const items = [...list.children];
    const size =
      Number(list.dataset.paginate) ||
      (list.classList.contains("production-grid")
        ? 2
        : list.classList.contains("photo-grid")
          ? 6
          : list.querySelector(".archive-group")
            ? 1
            : 6);
    if (items.length <= size) return;
    let page = 0;
    const pager = document.createElement("nav");
    pager.className = "pagination";
    pager.setAttribute("aria-label", "内容分页");
    const prev = document.createElement("button"),
      next = document.createElement("button"),
      status = document.createElement("span");
    prev.type = next.type = "button";
    prev.textContent = "上一页";
    next.textContent = "下一页";
    status.setAttribute("aria-live", "polite");
    const render = () => {
      items.forEach((item, i) => {
        item.hidden = i < page * size || i >= (page + 1) * size;
      });
      prev.disabled = page === 0;
      next.disabled = (page + 1) * size >= items.length;
      status.textContent = page + 1 + " / " + Math.ceil(items.length / size);
    };
    prev.addEventListener("click", () => {
      page--;
      render();
    });
    next.addEventListener("click", () => {
      page++;
      render();
    });
    pager.append(prev, status, next);
    list.after(pager);
    render();
  });
})();
