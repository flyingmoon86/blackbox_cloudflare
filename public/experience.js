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
    const mobileOpen = nav?.classList.contains("is-open");
    if (!current && !mobileOpen) return;
    close();
    nav?.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    restoringFocus = true;
    if (mobileOpen) toggle?.focus();
    else current?.querySelector("summary").focus();
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
    const sceneIndex = (hash) =>
      Math.max(
        0,
        scenes.findIndex((scene) => "#" + scene.id === (hash === "#contact" ? "#about" : hash)),
      );
    let index = sceneIndex(location.hash),
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
      if (update) history.replaceState(null, "", "#" + scenes[index].id);
    };
    const setup = () => {
      stage.classList.toggle("stage-ready", desktop.matches);
      show(index);
    };
    stage.querySelectorAll('a[href="#about"],a[href="#welcome"],a[href="#playbill"]').forEach((a) =>
      a.addEventListener("click", (event) => {
        if (!desktop.matches) return;
        event.preventDefault();
        show(sceneIndex(a.hash), true);
      }),
    );
    window.addEventListener("hashchange", () => {
      show(sceneIndex(location.hash));
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
    const photoGrid = list.classList.contains("photo-grid");
    const size =
      Number(list.dataset.paginate) ||
      (list.classList.contains("production-grid") ? 2 : photoGrid ? 6 : list.querySelector(".archive-group") ? 1 : 6);
    if (items.length <= size) return;
    const requestedPhoto = photoGrid ? new URLSearchParams(location.search).get("photo") : "";
    const requestedIndex = requestedPhoto
      ? items.findIndex((item) => new URL(item.href, location.href).pathname === "/resources/" + requestedPhoto)
      : -1;
    let page = requestedIndex >= 0 ? Math.floor(requestedIndex / size) : 0;
    const pager = document.createElement("nav");
    pager.className = "pagination";
    pager.setAttribute("aria-label", photoGrid ? "剧照分页" : "内容分页");
    const prev = document.createElement("button"),
      next = document.createElement("button"),
      status = document.createElement("span");
    prev.type = next.type = "button";
    prev.textContent = "上一页";
    next.textContent = "下一页";
    if (photoGrid) {
      prev.setAttribute("aria-label", "上一页剧照");
      next.setAttribute("aria-label", "下一页剧照");
    }
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
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

  const photoDialog = document.querySelector("[data-photo-dialog]");
  const photoLinks = [...document.querySelectorAll("a[data-photo-lightbox]")];
  if (photoDialog instanceof HTMLDialogElement && photoLinks.length && typeof photoDialog.showModal === "function") {
    const image = photoDialog.querySelector("[data-photo-image]");
    const caption = photoDialog.querySelector("[data-photo-caption]");
    const position = photoDialog.querySelector("[data-photo-position]");
    const detail = photoDialog.querySelector("[data-photo-detail]");
    const error = photoDialog.querySelector("[data-photo-error]");
    const previous = photoDialog.querySelector("[data-photo-prev]");
    const next = photoDialog.querySelector("[data-photo-next]");
    let index = 0;
    let opener = null;
    const show = (requested) => {
      index = (requested + photoLinks.length) % photoLinks.length;
      const link = photoLinks[index];
      image.hidden = false;
      error.hidden = true;
      image.src = link.dataset.preview;
      image.alt = link.querySelector("img")?.alt || link.dataset.caption || "剧照";
      caption.textContent = image.alt || link.dataset.caption;
      position.textContent = `${index + 1} / ${photoLinks.length}`;
      detail.href = link.href;
      previous.disabled = next.disabled = photoLinks.length < 2;
    };
    photoLinks.forEach((link, linkIndex) =>
      link.addEventListener("click", (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        opener = link;
        show(linkIndex);
        photoDialog.showModal();
      }),
    );
    previous.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    photoDialog.querySelector("[data-photo-close]").addEventListener("click", () => photoDialog.close());
    photoDialog.addEventListener("click", (event) => {
      if (event.target === photoDialog) photoDialog.close();
    });
    photoDialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show(index + (event.key === "ArrowRight" ? 1 : -1));
      }
    });
    photoDialog.addEventListener("close", () => opener?.focus());
    image.addEventListener("error", () => {
      image.hidden = true;
      error.hidden = false;
    });
  }
})();

// Preserve the native POST when JavaScript is unavailable. Update only after the
// server's redirect confirms the write result; an uncertain request is never retried.
(() => {
  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !/^\/members\/\d+\/flowers$/.test(new URL(form.action).pathname)) return;
    if (!form.closest(".profile-detail")) return;
    event.preventDefault();
    if (form.dataset.sending) return;
    form.dataset.sending = "true";
    const button = form.querySelector("button");
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "正在送达…";
    let status = form.querySelector('[role="status"]');
    if (!status) {
      status = document.createElement("p");
      status.setAttribute("role", "status");
      form.append(status);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        credentials: "same-origin",
        signal: controller.signal,
      });
      const url = new URL(response.url);
      const memberPath = new URL(form.action).pathname.replace(/\/flowers$/, "");
      const result = url.searchParams.get("flower");
      if (
        !response.ok ||
        url.origin !== location.origin ||
        url.pathname !== memberPath ||
        !["sent", "already"].includes(result)
      )
        throw new Error("Unconfirmed flower result");
      const doc = new DOMParser().parseFromString(await response.text(), "text/html");
      const fresh = doc.querySelector(".profile-detail");
      if (!fresh) throw new Error("Missing profile");
      form.closest(".profile-detail").dispatchEvent(new Event("profile:detach"));
      form.closest(".profile-detail").replaceWith(fresh);
      document.dispatchEvent(new Event("profile:updated"));
      const nextButton = fresh.querySelector('form[action$="/flowers"] button');
      nextButton?.focus({ preventScroll: true });
      if (result === "sent" && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const burst = document.createElement("div");
        burst.className = "flower-burst";
        burst.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 7; i++) {
          const petal = document.createElement("span");
          petal.textContent = "✻";
          burst.append(petal);
        }
        fresh.append(burst);
        setTimeout(() => burst.remove(), 1600);
      }
    } catch {
      status.textContent = "暂时无法确认送花结果，请刷新核对后再操作。";
      button.disabled = false;
      button.textContent = previous;
    } finally {
      clearTimeout(timeout);
      delete form.dataset.sending;
    }
  });
})();
// Fit the desktop profile into the available frame. Large collections paginate
// within their section; mobile and no-JS pages retain a complete readable document.
(() => {
  const media = matchMedia("(min-width:901px)");
  const attach = () => {
    const profile = document.querySelector(".member-detail");
    if (!profile || profile.dataset.profileFit) return;
    profile.dataset.profileFit = "true";
    const pagers = [];
    for (const selector of [".profile-experience>ul"]) {
      const list = profile.querySelector(selector);
      if (!list) continue;
      const items = [...list.children];
      let page = 0,
        size = items.length || 1;
      const pager = document.createElement("nav");
      pager.className = "profile-pagination";
      pager.setAttribute("aria-label", selector.includes("experience") ? "舞台经历分页" : "送花记录分页");
      const prev = document.createElement("button"),
        next = document.createElement("button"),
        status = document.createElement("span");
      prev.type = next.type = "button";
      prev.textContent = "上一页";
      next.textContent = "下一页";
      status.setAttribute("aria-live", "polite");
      pager.append(prev, status, next);
      list.after(pager);
      const render = () => {
        const pages = Math.max(1, Math.ceil(items.length / size));
        page = Math.min(page, pages - 1);
        items.forEach((item, i) => (item.hidden = media.matches && (i < page * size || i >= (page + 1) * size)));
        prev.disabled = page === 0;
        next.disabled = page >= pages - 1;
        status.textContent = `${page + 1} / ${pages}`;
        pager.hidden = !media.matches || pages <= 1;
      };
      const fit = () => {
        items.forEach((item) => (item.hidden = false));
        pager.hidden = false;
        if (!media.matches) {
          size = items.length || 1;
          render();
          return;
        }
        const columns = selector.includes("experience") ? 2 : 3;
        const row = Math.max(
          selector.includes("experience") ? 58 : 33,
          ...items.map((item) => item.getBoundingClientRect().height),
        );
        size = Math.max(columns, Math.floor(list.clientHeight / row) * columns);
        render();
      };
      prev.onclick = () => {
        page--;
        render();
      };
      next.onclick = () => {
        page++;
        render();
      };
      pagers.push(fit);
    }
    const bio = profile.querySelector(".profile-story>section:first-child>p");
    const more = document.createElement("button");
    more.type = "button";
    more.className = "profile-read-more";
    more.textContent = "展开完整介绍";
    more.hidden = true;
    bio?.after(more);
    more.onclick = () => {
      const dialog = document.createElement("dialog");
      dialog.className = "profile-biography";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "关闭";
      close.onclick = () => dialog.close();
      const text = document.createElement("p");
      text.textContent = bio.textContent;
      dialog.append(close, text);
      document.body.append(dialog);
      dialog.onclose = () => {
        dialog.remove();
        more.focus();
      };
      dialog.showModal();
    };
    const fit = () => {
      profile.classList.toggle("profile-fixed", media.matches);
      pagers.forEach((fn) => fn());
      more.hidden = !media.matches || !bio || bio.scrollHeight <= bio.clientHeight + 2;
    };
    let frame;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(profile);
    media.addEventListener("change", schedule);
    document.fonts?.ready.then(() => {
      if (profile.isConnected) schedule();
    });
    fit();
    profile.addEventListener(
      "profile:detach",
      () => {
        observer.disconnect();
        media.removeEventListener("change", schedule);
        cancelAnimationFrame(frame);
      },
      { once: true },
    );
  };
  attach();
  document.addEventListener("profile:updated", attach);
})();

// Translate historic edition anchors to the selected-version URL.
(() => {
  const openLegacy = () => {
    if (!/^#edition-\d+$/.test(location.hash) || document.querySelector(location.hash)) return;
    const link = [...document.querySelectorAll(".edition-nav a")].find((a) => a.hash === location.hash);
    if (link) location.replace(link.href);
  };
  openLegacy();
  window.addEventListener("hashchange", openLegacy);
})();
