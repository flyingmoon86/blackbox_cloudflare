import { downloadModel, clearRecentModel } from "./three-d-download.js";

window.blackboxPages?.register("three-d-archive", (root, scope) => {
  const archive = root.querySelector("[data-splat-archive]");
  if (!archive) return;
  const dialog = archive.querySelector("dialog");
  const viewport = archive.querySelector("[data-splat-viewport]");
  const status = archive.querySelector("[data-splat-status]");
  const help = archive.querySelector("[data-splat-help]");
  const hint = archive.querySelector(".splat-hint");
  const loading = archive.querySelector("[data-splat-loading]");
  const poster = archive.querySelector("[data-splat-poster]");
  const loadingTitle = archive.querySelector("[data-splat-loading-title]");
  const loadingDetail = archive.querySelector("[data-splat-loading-detail]");
  const progress = archive.querySelector("[data-splat-progress]");
  const retry = archive.querySelector("[data-splat-retry]");
  const tools = [...archive.querySelectorAll("[data-splat-action]")];
  const spin = tools.find((button) => button.dataset.splatAction === "spin");
  const fullscreen = tools.find((button) => button.dataset.splatAction === "fullscreen");
  fullscreen.hidden = !document.fullscreenEnabled;
  let operation;
  let viewer;
  let selected;

  function report(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }

  function clear() {
    operation?.abort();
    operation = undefined;
    viewer?.dispose();
    viewer = undefined;
    loading.hidden = true;
    viewport.setAttribute("aria-busy", "false");
    hint.hidden = true;
    help.setAttribute("aria-expanded", "false");
    for (const button of tools) button.disabled = true;
    spin.setAttribute("aria-pressed", "false");
    if (document.fullscreenElement === dialog) document.exitFullscreen().catch(() => {});
  }

  async function open(button) {
    clear();
    selected = button;
    const startedAt = performance.now();
    dialog.querySelector("h2").textContent = button.dataset.splatTitle;
    if (!dialog.open) dialog.showModal();
    report();
    const cover = button.closest(".splat-card").querySelector("img");
    poster.hidden = !cover;
    if (cover) poster.src = cover.currentSrc || cover.src;
    else poster.removeAttribute("src");
    loading.hidden = false;
    viewport.setAttribute("aria-busy", "true");
    loadingTitle.textContent = "正在下载模型…";
    loadingDetail.textContent = "准备好完整画面后即可自由旋转。";
    progress.hidden = false;
    progress.removeAttribute("value");
    retry.hidden = true;
    const controller = new AbortController();
    operation = controller;
    const { signal } = controller;
    try {
      const update = ({ stage, loaded, total }) => {
        if (signal.aborted) return;
        if (stage === "prepare") {
          loadingTitle.textContent = "正在准备完整画面…";
          loadingDetail.textContent = "下载已完成，正在解析模型并准备显示。";
          progress.hidden = true;
        } else {
          const percent = total ? Math.min(99, Math.floor((loaded / total) * 100)) : 0;
          loadingTitle.textContent = "正在下载模型" + (total ? " · " + percent + "%" : "…");
          if (total) {
            progress.max = total;
            progress.value = loaded;
          }
          loadingDetail.textContent =
            (loaded / 1e6).toFixed(1) + (total ? " / " + (total / 1e6).toFixed(1) : "") + " MB · 完整加载后即可旋转";
        }
      };
      let engineReadyAt;
      const [module, download] = await Promise.all([
        import(archive.dataset.splatEngine).then((module) => {
          engineReadyAt = performance.now();
          return module;
        }),
        downloadModel(button.dataset.splatOpen, signal, update),
      ]);
      signal.throwIfAborted();
      viewer = module.createSplatViewer(viewport);
      const timing = await viewer.load(download, signal);
      signal.throwIfAborted();
      loading.hidden = true;
      viewport.setAttribute("aria-busy", "false");
      for (const tool of tools) tool.disabled = false;
      // Local Performance API only: no analytics upload or persistent tracking.
      performance.clearMeasures("three-d-load");
      performance.measure("three-d-load", {
        start: startedAt,
        end: timing.readyAt,
        detail: { ...timing, engineReadyAt, clickedAt: startedAt },
      });
      report();
    } catch (error) {
      if (signal.aborted) return;
      clearRecentModel();
      clear();
      loading.hidden = false;
      loadingTitle.textContent = "暂时无法打开场景";
      loadingDetail.textContent = error.message || "请检查网络后重试。";
      progress.hidden = true;
      retry.hidden = false;
    }
  }

  for (const button of archive.querySelectorAll("[data-splat-open]")) {
    scope.listen(button, "click", () => open(button));
  }
  scope.listen(help, "click", () => {
    hint.hidden = !hint.hidden;
    help.setAttribute("aria-expanded", String(!hint.hidden));
  });
  scope.listen(retry, "click", () => {
    if (selected) open(selected);
  });
  for (const button of tools) {
    scope.listen(button, "click", async () => {
      if (!viewer) return;
      const action = button.dataset.splatAction;
      if (action === "fullscreen") {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await dialog.requestFullscreen();
        } catch {
          report("当前浏览器无法进入全屏。");
        }
        return;
      }
      spin.setAttribute("aria-pressed", String(viewer.act(action)));
      report();
    });
  }
  scope.listen(dialog, "close", clear);
  scope.listen(dialog, "keydown", (event) => {
    if (event.key.toLowerCase() === "r" && !event.altKey && !event.ctrlKey && !event.metaKey)
      tools.find((button) => button.dataset.splatAction === "reset").click();
  });
  scope.listen(document, "fullscreenchange", () => {
    fullscreen.textContent = document.fullscreenElement === dialog ? "退出全屏" : "全屏";
  });
  scope.dispose(clear);
});
