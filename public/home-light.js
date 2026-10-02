(() => {
  const scene = document.querySelector("[data-theatre-scene]");
  const base = scene?.querySelector("[data-theatre-base]");
  const light = scene?.querySelector("[data-theatre-light]");
  const toggle = scene?.querySelector(".theatre-light-switch");
  const status = scene?.querySelector(".theatre-light-status");
  const art = scene?.querySelector(".theatre-art");
  const plane = scene?.querySelector(".stage-image-plane");
  if (!base || !light || !toggle || !status || !art || !plane) return;
  const preview = scene.hasAttribute("data-stage-preview");
  let config = JSON.parse(scene.dataset.stageConfig || "{}");
  let failed = false;
  const key = "blackbox-stage-lights";
  const savedState = () => {
    try {
      return localStorage.getItem(key) === "on";
    } catch {
      return false;
    }
  };
  const setLights = (on) => {
    scene.dataset.lights = on ? "on" : "off";
    toggle.setAttribute("aria-pressed", String(on));
    toggle.title = (on ? "关灯" : "开灯") + "（四页同步）";
  };
  const crop = () => {
    const mobile = matchMedia("(max-width:900px)").matches;
    const width = base.naturalWidth || Number(base.width),
      height = base.naturalHeight || Number(base.height);
    const scale = Math.max(art.clientWidth / width, art.clientHeight / height);
    const x = config[mobile ? "mobileX" : "desktopX"] ?? 50,
      y = config[mobile ? "mobileY" : "desktopY"] ?? 50;
    Object.assign(plane.style, {
      width: width * scale + "px",
      height: height * scale + "px",
      left: ((art.clientWidth - width * scale) * x) / 100 + "px",
      top: ((art.clientHeight - height * scale) * y) / 100 + "px",
    });
  };
  const apply = () => {
    scene.style.setProperty("--stage-intensity", (config.intensity ?? 100) / 100);
    scene.style.setProperty("--stage-shade", (config.shade ?? 58) / 100);
    scene.dataset.direction = config.direction === false ? "off" : "on";
    crop();
  };
  const ready = () => {
    if (!failed && base.complete && base.naturalWidth && light.complete && light.naturalWidth) {
      if (base.naturalWidth !== light.naturalWidth || base.naturalHeight !== light.naturalHeight)
        return failure(light, "底图与光层尺寸不一致，已保留底图。");
      toggle.disabled = false;
      crop();
    }
  };
  const failure = (image, message) => {
    failed = true;
    image.hidden = true;
    light.hidden = true;
    setLights(false);
    toggle.disabled = true;
    toggle.title = "灯光暂不可用";
    status.textContent = message || (image === base ? "背景暂未加载，已显示纸色底。" : "灯光暂未加载，保留关灯背景。");
  };
  for (const img of [base, light]) {
    img.addEventListener("load", ready);
    img.addEventListener("error", () => failure(img));
    if (img.complete && !img.naturalWidth) failure(img);
  }
  setLights(!failed && !preview && savedState());
  toggle.addEventListener("click", () => {
    const on = scene.dataset.lights !== "on";
    setLights(on);
    if (!preview)
      try {
        localStorage.setItem(key, on ? "on" : "off");
      } catch {}
  });
  window.addEventListener("storage", (event) => {
    if (!preview && !failed && (event.key === key || event.key === null)) setLights(savedState());
  });
  window.addEventListener("pageshow", () => {
    if (!preview && !failed) setLights(savedState());
  });
  new ResizeObserver(crop).observe(art);
  window.addEventListener("resize", crop);
  apply();
  ready();
  if (preview) {
    document.documentElement.classList.add("stage-preview-page");
    // Keep a preview on its selected page; it must not submit forms or navigate
    // the administrator away from the visual editor.
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (link && !link.getAttribute("href")?.startsWith("#")) event.preventDefault();
    });
    document.addEventListener("submit", (event) => event.preventDefault());
    window.addEventListener("message", (event) => {
      if (
        event.origin !== location.origin ||
        event.source !== parent ||
        event.data?.type !== "stage-preview" ||
        event.data.scene !== scene.dataset.theatreScene
      )
        return;
      config = event.data.config;
      for (const [img, source] of [
        [base, event.data.base],
        [light, event.data.light],
      ]) {
        if (source && new URL(source, location.href).origin === location.origin && img.getAttribute("src") !== source) {
          failed = false;
          status.textContent = "";
          base.hidden = light.hidden = false;
          toggle.disabled = true;
          img.src = source;
        }
      }
      apply();
      if (!failed) setLights(Boolean(event.data.on));
      ready();
    });
    parent.postMessage({ type: "stage-preview-ready", scene: scene.dataset.theatreScene }, location.origin);
  }
})();
