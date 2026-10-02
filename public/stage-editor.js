(() => {
  document.querySelectorAll("[data-stage-editor]").forEach((editor) => {
    const frame = editor.querySelector("iframe"),
      shell = editor.querySelector(".stage-preview-shell");
    const mode = editor.querySelector("[data-pair-mode]");
    const baseInput = editor.querySelector("[data-pair-base]"),
      lightInput = editor.querySelector("[data-pair-light]");
    const lightButton = editor.querySelector("[data-preview-light]");
    const size = editor.querySelector("[data-preview-size]");
    const status = editor.querySelector(".stage-upload-status");
    let on = false,
      uploaded = null,
      revision = 0;
    const sources = () =>
      mode.value === "upload" && uploaded
        ? uploaded
        : {
            base: editor.dataset[mode.value === "builtin" ? "builtinBase" : "currentBase"],
            light: editor.dataset[mode.value === "builtin" ? "builtinLight" : "currentLight"],
          };
    const update = () => {
      const config = {};
      editor.querySelectorAll("[data-stage-field]").forEach((input) => {
        config[input.dataset.stageField] = Number(input.value);
        input.previousElementSibling.textContent = input.value + "%";
      });
      config.direction = editor.querySelector("[data-direction-mode]")?.value === "preset";
      frame.contentWindow?.postMessage(
        { type: "stage-preview", scene: editor.dataset.stageEditor, config, ...sources(), on },
        location.origin,
      );
    };
    const resize = () => {
      if (!editor.clientWidth) return;
      const mobile = size.value === "mobile",
        width = mobile ? 390 : 1280,
        height = mobile ? 844 : 800;
      const style = getComputedStyle(editor);
      const available = editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const scale = Math.min(1, (available - 2) / width);
      shell.style.width = width * scale + "px";
      shell.style.height = height * scale + "px";
      frame.style.width = width + "px";
      frame.style.height = height + "px";
      frame.style.transform = `scale(${scale})`;
    };
    const clearUpload = () => {
      if (uploaded) {
        URL.revokeObjectURL(uploaded.base);
        URL.revokeObjectURL(uploaded.light);
      }
      uploaded = null;
    };
    const validate = async () => {
      const attempt = ++revision;
      clearUpload();
      baseInput.setCustomValidity("");
      lightInput.setCustomValidity("");
      if (mode.value !== "upload") {
        status.textContent = "";
        update();
        return;
      }
      const base = baseInput.files[0],
        light = lightInput.files[0];
      if (!base || !light) {
        status.textContent = "请同时选择底图与透明光层。";
        update();
        return;
      }
      status.textContent = "正在检查尺寸与透明通道…";
      const urls = { base: URL.createObjectURL(base), light: URL.createObjectURL(light) };
      try {
        if (base.size > 8 * 1024 * 1024 || light.size > 8 * 1024 * 1024) throw Error("每张 PNG 不能超过 8 MB。");
        const images = await Promise.all(
          Object.values(urls).map(
            (src) =>
              new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(Error("无法读取 PNG 图片。"));
                img.src = src;
              }),
          ),
        );
        const [a, b] = images;
        if (a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight)
          throw Error("底图与光层像素尺寸必须一致。");
        if (a.naturalWidth * a.naturalHeight > 8_000_000) throw Error("素材不能超过 800 万像素。");
        const canvas = document.createElement("canvas");
        canvas.width = b.naturalWidth;
        canvas.height = b.naturalHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(b, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let transparent = false,
          visible = false;
        for (let i = 3; i < pixels.length; i += 4) {
          transparent ||= pixels[i] < 255;
          visible ||= pixels[i] > 0;
        }
        if (!transparent || !visible) throw Error("光层必须有透明区域和可见灯光，不能使用不透明黑底。");
        if (attempt !== revision) {
          Object.values(urls).forEach(URL.revokeObjectURL);
          return;
        }
        uploaded = urls;
        status.textContent = `${a.naturalWidth} × ${a.naturalHeight}，两层对齐、透明通道正常。保存后生效。`;
        update();
      } catch (error) {
        Object.values(urls).forEach(URL.revokeObjectURL);
        if (attempt !== revision) return;
        status.textContent = error.message;
        lightInput.setCustomValidity(error.message);
      }
    };
    mode.addEventListener("change", () => {
      const upload = mode.value === "upload";
      editor.querySelector("[data-pair-upload]").hidden = !upload;
      for (const input of [baseInput, lightInput]) {
        input.disabled = !upload;
        input.required = upload;
      }
      validate();
    });
    for (const input of [baseInput, lightInput]) input.addEventListener("change", validate);
    editor
      .querySelectorAll("[data-stage-field],[data-direction-mode]")
      .forEach((input) => input.addEventListener("input", update));
    lightButton.addEventListener("click", () => {
      on = !on;
      lightButton.setAttribute("aria-pressed", String(on));
      lightButton.textContent = on ? "预览关灯" : "预览开灯";
      update();
    });
    size.addEventListener("change", resize);
    frame.addEventListener("load", update);
    window.addEventListener("message", (event) => {
      if (
        event.origin === location.origin &&
        event.source === frame.contentWindow &&
        event.data?.type === "stage-preview-ready"
      )
        update();
    });
    new ResizeObserver(resize).observe(editor);
    window.addEventListener("pagehide", clearUpload, { once: true });
    resize();
  });
})();
