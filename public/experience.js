// Reveal the work after its cover and fonts are ready; never trap navigation.
(() => {
  const work = document.querySelector(".work-detail");
  const cover = work?.querySelector("img[data-curtain-src]");
  const coverUrl = cover?.dataset.curtainSrc;
  const nativeCover = () => {
    if (cover) {
      cover.src = coverUrl;
      cover.hidden = false;
    }
  };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const boot = window.blackboxCurtainBoot;
  if (
    !work ||
    !boot ||
    boot?.cancelled ||
    motion.matches ||
    location.search ||
    location.hash ||
    performance.getEntriesByType("navigation")[0]?.type === "back_forward"
  ) {
    nativeCover();
    boot?.release();
    return;
  }
  const curtain = document.createElement("div");
  curtain.className = "work-curtain";
  // Each fold has its own carrier: the leading edge gathers fabric before the stack exits.
  const svgNS = "http://www.w3.org/2000/svg";
  const cloth = document.createElementNS(svgNS, "svg");
  cloth.setAttribute("class", "curtain-cloth");
  cloth.setAttribute("viewBox", "0 0 1200 1000");
  cloth.setAttribute("preserveAspectRatio", "none");
  cloth.setAttribute("aria-hidden", "true");
  cloth.innerHTML = `<defs>
    <linearGradient id="curtain-fold"><stop stop-color="#210508"/><stop offset=".13" stop-color="#4e0b12"/><stop offset=".32" stop-color="#901d29"/><stop offset=".48" stop-color="#b93640"/><stop offset=".64" stop-color="#951d29"/><stop offset=".85" stop-color="#4b0911"/><stop offset="1" stop-color="#210508"/></linearGradient>
    <linearGradient id="curtain-weight" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".54"/><stop offset=".16" stop-color="#ff9b8e" stop-opacity=".12"/><stop offset=".55" stop-color="#530815" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity=".58"/></linearGradient>
    <filter id="curtain-nap" x="-3%" y="-1%" width="106%" height="102%">
      <feTurbulence type="fractalNoise" baseFrequency="16 .42" numOctaves="2" seed="19" stitchTiles="stitch" result="fiber"/>
      <feColorMatrix in="fiber" type="matrix" values="0 0 0 0 .82 0 0 0 0 .05 0 0 0 0 .08 0 0 0 .16 0" result="redFiber"/>
      <feBlend in="SourceGraphic" in2="redFiber" mode="screen" result="velvet"/>
      <feComposite in="velvet" in2="SourceGraphic" operator="in" result="clippedVelvet"/>
      <feDisplacementMap in="clippedVelvet" in2="fiber" scale="1.2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>`;
  const folds = [];
  const foldCount = matchMedia("(max-width:600px)").matches ? 6 : 10;
  for (let side = 0; side < 2; side++) {
    const group = document.createElementNS(svgNS, "g");
    if (side) group.setAttribute("transform", "translate(1200 0) scale(-1 1)");
    for (let index = 0; index < foldCount; index++) {
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("fill", "url(#curtain-fold)");
      path.setAttribute("filter", "url(#curtain-nap)");
      const shade = document.createElementNS(svgNS, "path");
      shade.setAttribute("fill", "url(#curtain-weight)");
      group.append(path, shade);
      folds.push({ path, shade, index, side });
    }
    cloth.append(group);
  }
  const clamp = (value) => Math.max(0, Math.min(1, value));
  const drawCloth = (progress) => {
    for (const { path, shade, index, side } of folds) {
      const edge = (i, depth) => {
        const delayed = clamp((progress - depth * 0.045) / (1 - depth * 0.045));
        const lead = 604 - 760 * delayed;
        const rest = i * (604 / foldCount) + (i > 0 && i < foldCount ? Math.sin(i * 1.4) * 6 : 0);
        const packed = 11 + Math.sin(i * 1.7) * 1.2;
        const x = Math.min(rest, lead - (foldCount - i) * packed);
        const slack = Math.sin(Math.PI * delayed);
        const drape = x + Math.sin(i * 1.3 + side * 0.6 + depth * 2) * (3 + 5 * slack) * depth + 12 * slack * depth;
        return i === 0 ? Math.min(-8, drape) : drape;
      };
      const a = [edge(index, 0), edge(index, 0.35), edge(index, 0.7), edge(index, 1)];
      const b = [edge(index + 1, 0), edge(index + 1, 0.35), edge(index + 1, 0.7), edge(index + 1, 1)];
      const d = `M ${a[0]} -8 C ${a[1]} 260 ${a[2]} 700 ${a[3]} 1010 L ${b[3] + 1} 1010 C ${b[2] + 1} 700 ${b[1] + 1} 260 ${b[0] + 1} -8 Z`;
      path.setAttribute("d", d);
      shade.setAttribute("d", d);
    }
  };
  drawCloth(0);
  curtain.append(cloth);
  let clothFrame;
  const panel = document.createElement("div");
  panel.className = "curtain-progress";
  const bell = document.createElement("span");
  bell.className = "curtain-bell";
  bell.textContent = "🔔";
  bell.setAttribute("aria-hidden", "true");
  const label = document.createElement("p");
  label.setAttribute("role", "status");
  label.textContent = "正在准备封面";
  const progress = document.createElement("div");
  progress.className = "curtain-meter";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", "封面下载进度");
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("span");
  progress.append(fill);
  const detail = document.createElement("p");
  detail.className = "curtain-transfer";
  detail.textContent = cover ? "等待服务器响应" : "此作品暂无封面";
  let fillAnimation;
  const updateBytes = (loaded, total) => {
    const formatBytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.floor(n / 1024) + " KB");
    detail.textContent = total
      ? Math.floor(Math.min(loaded / total, 1) * 100) + "% · " + formatBytes(loaded) + " / " + formatBytes(total)
      : "已接收 " + formatBytes(loaded);
    if (total > 0) {
      const fraction = Math.min(loaded / total, 1);
      progress.setAttribute("aria-valuenow", String(Math.floor(fraction * 100)));
      const previous = getComputedStyle(fill).transform;
      fillAnimation?.cancel();
      fillAnimation = fill.animate(
        [{ transform: previous === "none" ? "scaleX(0)" : previous }, { transform: "scaleX(" + fraction + ")" }],
        { duration: 260, easing: "ease-out", fill: "forwards" },
      );
    }
  };
  const sound = document.createElement("button");
  sound.type = "button";
  sound.textContent = "开启铃声";
  let audio;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    /* Visual feedback remains available. */
  }
  if (!audio) {
    sound.disabled = true;
    sound.textContent = "铃声不可用";
  }
  sound.onclick = async () => {
    try {
      if (audio?.state === "running") {
        await audio.suspend();
      } else {
        await audio?.resume();
      }
      sound.textContent = audio?.state === "running" ? "关闭铃声" : "开启铃声";
    } catch {
      sound.textContent = "铃声不可用";
    }
  };
  if (audio?.state === "running") sound.textContent = "关闭铃声";
  const ring = () => {
    bell.classList.remove("is-ringing");
    void bell.offsetWidth;
    bell.classList.add("is-ringing");
    if (audio?.state !== "running") return;
    const now = audio.currentTime;
    for (const [frequency, volume] of [
      [880, 0.045],
      [1760, 0.018],
    ]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.3);
    }
  };
  const skip = document.createElement("button");
  skip.type = "button";
  skip.textContent = "直接查看";
  panel.append(bell, label, progress, detail, sound, skip);
  curtain.append(panel);
  document.body.append(curtain);
  // Swap both curtains in one task, before the browser can paint the stage.
  boot?.release();
  let opened = false;
  let deadline;
  let cleanup;
  const remove = () => {
    clearTimeout(deadline);
    clearTimeout(cleanup);
    const focused = curtain.contains(document.activeElement);
    curtain.remove();
    cancelAnimationFrame(clothFrame);
    fillAnimation?.cancel();
    audio?.close().catch(() => {});
    if (focused) document.querySelector("#main-content")?.focus({ preventScroll: true });
    window.removeEventListener("pagehide", remove);
    document.removeEventListener("keydown", onKey);
    motion.removeEventListener("change", remove);
  };
  const onKey = (event) => {
    if (event.key === "Escape") remove();
    if (event.key === "Tab" && !opened) {
      event.preventDefault();
      const controls = [sound, skip].filter((button) => !button.disabled);
      const current = controls.indexOf(document.activeElement);
      const next =
        current < 0
          ? event.shiftKey
            ? controls.length - 1
            : 0
          : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      controls[next].focus({ preventScroll: true });
    }
  };
  const open = () => {
    if (opened || !curtain.isConnected) return;
    opened = true;
    clearTimeout(deadline);
    if (curtain.contains(document.activeElement))
      document.querySelector("#main-content")?.focus({ preventScroll: true });
    panel.hidden = true;
    curtain.classList.add("is-opening");
    const started = performance.now();
    const animateCloth = (now) => {
      const elapsed = clamp((now - started) / 4200);
      // Smooth traction and braking, with no elastic bounce.
      drawCloth(elapsed * elapsed * (3 - 2 * elapsed));
      if (elapsed < 1 && curtain.isConnected) clothFrame = requestAnimationFrame(animateCloth);
      else remove();
    };
    clothFrame = requestAnimationFrame(animateCloth);
    cleanup = setTimeout(remove, 4700);
  };
  skip.onclick = remove;
  document.addEventListener("keydown", onKey);
  window.addEventListener("pagehide", remove);
  motion.addEventListener("change", remove);
  // A single image request supplies both actual transfer progress and the displayed cover.
  // No synthetic percentages for HTML, font loading, decode or unknown response lengths.
  const imageReady = cover
    ? new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("GET", coverUrl);
        request.responseType = "blob";
        request.onprogress = (event) => {
          if (!curtain.isConnected || opened) return;
          label.textContent = "封面加载中";
          updateBytes(event.loaded, event.lengthComputable ? event.total : 0);
        };
        request.onerror = () => reject(new Error("封面加载失败"));
        request.onload = async () => {
          if (request.status < 200 || request.status >= 300) {
            reject(new Error("封面加载失败"));
            return;
          }
          const blob = request.response;
          const url = URL.createObjectURL(blob);
          window.addEventListener(
            "pagehide",
            (event) => {
              if (!event.persisted) URL.revokeObjectURL(url);
            },
            { once: true },
          );
          cover.src = url;
          cover.hidden = false;
          try {
            if (curtain.isConnected) {
              updateBytes(blob.size, blob.size);
              label.textContent = "封面已接收，正在显示";
            }
            await cover.decode();
            resolve();
          } catch {
            URL.revokeObjectURL(url);
            reject(new Error("封面无法显示"));
          }
        };
        request.send();
      })
    : Promise.resolve();
  const fontsReady = (document.fonts?.ready || Promise.resolve()).then(() => {
    if (document.fonts && [...document.fonts].some((font) => font.status === "error")) return false;
    return true;
  });
  // Eager images and scripts; lazy off-screen gallery images must not delay entry.
  const pageReady =
    document.readyState === "complete"
      ? Promise.resolve()
      : new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
  // CSS backgrounds may only start after the initially hidden body becomes visible.
  const backdropUrl = getComputedStyle(document.body, "::before").backgroundImage.match(
    /url\(["']?([^"')]+)["']?\)/,
  )?.[1];
  const backdropReady = backdropUrl
    ? new Promise((resolve) => {
        const backdrop = new Image();
        backdrop.onload = () =>
          backdrop.decode().then(
            () => resolve(true),
            () => resolve(false),
          );
        backdrop.onerror = () => resolve(false);
        backdrop.src = backdropUrl;
      })
    : Promise.resolve(true);
  deadline = setTimeout(() => {
    if (!opened && curtain.isConnected) detail.textContent += " · 加载较慢，可直接查看";
  }, 8000);
  (async () => {
    ring();
    try {
      await imageReady;
      if (!curtain.isConnected) return;
      ring();
      label.textContent = "封面已就绪，正在准备字体";
      const fontsLoaded = await fontsReady;
      if (!curtain.isConnected) return;
      label.textContent = "正在准备页面资源";
      await pageReady;
      const backdropLoaded = await backdropReady;
      if (!curtain.isConnected) return;
      label.textContent = !fontsLoaded
        ? "字体加载失败，使用系统字体"
        : !backdropLoaded
          ? "背景加载失败，使用纯色舞台"
          : "舞台已就绪";
      ring();
      // Let the last measured byte update settle before the separate opening animation.
      await new Promise((resolve) => setTimeout(resolve, 280));
      open();
    } catch (error) {
      if (cover) {
        cover.hidden = false;
        cover.alt = "封面暂时无法加载";
      }
      clearTimeout(deadline);
      if (curtain.isConnected) label.textContent = error.message + "，可刷新重试或直接查看";
    }
  })();
})();

(() => {
  const nav = document.querySelector("#main-navigation"),
    toggle = document.querySelector(".menu-toggle"),
    header = document.querySelector(".top");
  const menus = [...document.querySelectorAll(".nav-menu")];
  let closeTimer,
    restoringFocus = false;
  const sync = () => {
    menus.forEach((m) => {
      const expanded = m.classList.contains("is-open");
      const toggleMenu = m.querySelector(".nav-menu-toggle");
      toggleMenu.setAttribute("aria-expanded", String(expanded));
      toggleMenu.setAttribute(
        "aria-label",
        (expanded ? "收起" : "展开") + m.querySelector(".nav-menu-link").textContent.trim() + "子菜单",
      );
      m.querySelector(".nav-panel").hidden = !expanded;
    });
    document.body.classList.toggle(
      "navigation-open",
      menus.some((m) => m.classList.contains("is-open")),
    );
  };
  const close = () => {
    clearTimeout(closeTimer);
    menus.forEach((m) => m.classList.remove("is-open"));
    sync();
  };
  const open = (m) => {
    clearTimeout(closeTimer);
    menus.forEach((other) => other.classList.toggle("is-open", other === m));
    sync();
  };
  menus.forEach((m) => {
    const toggleMenu = m.querySelector(".nav-menu-toggle");
    toggleMenu.setAttribute("aria-expanded", "false");
    toggleMenu.addEventListener("click", () => (m.classList.contains("is-open") ? close() : open(m)));
    m.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch" && matchMedia("(min-width:901px)").matches) open(m);
    });
    m.addEventListener("focusin", (event) => {
      if (
        !restoringFocus &&
        matchMedia("(min-width:901px)").matches &&
        event.target.matches(".nav-menu-link:focus-visible,.nav-menu-toggle:focus-visible")
      )
        open(m);
    });
    toggleMenu.addEventListener("keydown", (event) => {
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
    ?.querySelectorAll(".desktop-nav>a:not(.nav-menu-link),.account-link,.brand")
    .forEach((a) => a.addEventListener("pointerenter", close));
  toggle?.addEventListener("click", () => {
    const expanded = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(expanded));
    if (!expanded) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const current = menus.find((m) => m.classList.contains("is-open"));
    const mobileOpen = nav?.classList.contains("is-open");
    if (!current && !mobileOpen) return;
    close();
    nav?.classList.remove("is-open");
    toggle?.setAttribute("aria-expanded", "false");
    restoringFocus = true;
    if (mobileOpen) toggle?.focus();
    else current?.querySelector(".nav-menu-toggle").focus();
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
    let scrollPosition = null;
    const historyKey = `photo-viewer-${Date.now()}`;
    const main = document.querySelector("main");
    const context = document.createElement("p");
    context.className = "photo-lightbox-context";
    context.textContent = [
      document.querySelector(".production-hero h1")?.textContent,
      document.querySelector(".production-edition .edition-year")?.textContent,
      document.querySelector(".production-edition .edition-heading h2")?.textContent,
    ]
      .filter(Boolean)
      .join(" · ");
    photoDialog.querySelector(".photo-lightbox-bar").before(context);
    position.setAttribute("aria-live", "polite");
    const close = () => photoDialog.close();
    const show = (requested) => {
      index = (requested + photoLinks.length) % photoLinks.length;
      const link = photoLinks[index];
      image.hidden = false;
      error.hidden = true;
      image.src = link.dataset.preview;
      image.alt = link.querySelector("img")?.alt || link.dataset.caption || "剧照";
      caption.textContent = link.dataset.caption || image.alt;
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
        scrollPosition = { x: scrollX, y: scrollY, main: main?.scrollTop || 0 };
        show(linkIndex);
        photoDialog.showModal();
        document.documentElement.classList.add("photo-viewing");
        history.pushState({ ...history.state, photoViewer: historyKey }, "", location.href);
      }),
    );
    previous.addEventListener("click", () => show(index - 1));
    next.addEventListener("click", () => show(index + 1));
    photoDialog.querySelector("[data-photo-close]").addEventListener("click", close);
    photoDialog.addEventListener("click", (event) => {
      if (event.target === photoDialog) close();
    });
    photoDialog.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        show(index + (event.key === "ArrowRight" ? 1 : -1));
      }
    });
    window.addEventListener("popstate", () => {
      if (photoDialog.open && history.state?.photoViewer !== historyKey) close();
    });
    photoDialog.addEventListener("close", () => {
      document.documentElement.classList.remove("photo-viewing");
      opener?.focus({ preventScroll: true });
      if (scrollPosition) {
        window.scrollTo({ left: scrollPosition.x, top: scrollPosition.y, behavior: "instant" });
        if (main) main.scrollTop = scrollPosition.main;
      }
      if (history.state?.photoViewer === historyKey) history.back();
    });
    let touch = null;
    const stage = photoDialog.querySelector(".photo-lightbox-stage");
    stage.addEventListener(
      "touchstart",
      (event) => {
        touch = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
      },
      { passive: true },
    );
    stage.addEventListener("touchcancel", () => {
      touch = null;
    });
    stage.addEventListener(
      "touchend",
      (event) => {
        if (!touch || !event.changedTouches.length) return;
        const dx = event.changedTouches[0].clientX - touch.x;
        const dy = event.changedTouches[0].clientY - touch.y;
        touch = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
      },
      { passive: true },
    );
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

// A single, decorative cue after a native edition-link navigation.
(() => {
  const nav = document.querySelector(".edition-tabs");
  const heading = document.querySelector(".production-edition > .edition-heading");
  if (!nav || !heading) return;
  const key = "blackbox-edition-light";
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const clear = () => heading.classList.remove("edition-light-enter");
  try {
    const pending = JSON.parse(sessionStorage.getItem(key) || "null");
    sessionStorage.removeItem(key);
    const navigation = performance.getEntriesByType("navigation")[0];
    if (
      !motion.matches &&
      navigation?.type === "navigate" &&
      pending?.url === location.href &&
      Date.now() - pending.time < 15000 &&
      location.hash === `#${heading.parentElement.id}`
    ) {
      heading.classList.add("edition-light-enter");
      setTimeout(clear, 450);
    }
  } catch {
    /* Storage restrictions leave native navigation intact. */
  }
  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      link.target ||
      link.getAttribute("aria-current") === "page" ||
      motion.matches
    )
      return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ url: link.href, time: Date.now() }));
    } catch {
      /* The effect is optional. */
    }
  });
  window.addEventListener("pagehide", clear);
  motion.addEventListener("change", clear);
})();
