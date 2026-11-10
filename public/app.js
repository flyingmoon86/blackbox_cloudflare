document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm))
    event.preventDefault();
});

const path = location.pathname;
const section =
  path === "/"
    ? "home"
    : path.startsWith("/productions") || path.startsWith("/resources")
      ? "archive"
      : path.startsWith("/members")
        ? "members"
        : path.startsWith("/profile")
          ? "profile"
          : "";
document.querySelector(`[data-section="${section}"]`)?.setAttribute("aria-current", "page");

for (const video of document.querySelectorAll("video[data-preview-frame]")) {
  video.addEventListener(
    "loadedmetadata",
    () => {
      const frame = Number.isFinite(video.duration) ? Math.min(0.8, Math.max(0.1, video.duration * 0.03)) : 0.1;
      if (Math.abs(video.currentTime - frame) > 0.05) video.currentTime = frame;
    },
    { once: true },
  );
}

for (const select of document.querySelectorAll("[data-resource-edition]")) {
  const production = select.form?.elements.production_id;
  if (!production) continue;
  const options = [...select.options].map((option) => option.cloneNode(true));
  const update = () => {
    select.required = Boolean(production.value);
    select.disabled = !production.value;
    const previous = select.value;
    select.replaceChildren(
      ...options
        .filter((option) => !option.value || option.dataset.production === production.value)
        .map((option) => option.cloneNode(true)),
    );
    select.value = [...select.options].some((option) => option.value === previous) ? previous : "";
  };
  production.addEventListener("change", update);
  update();
}

for (const section of document.querySelectorAll("[data-role-counts]")) {
  const kind = section.querySelector("[data-role-kind]");
  const name = section.querySelector("[data-role-name]");
  const edition = section.querySelector('[name="edition_id"]');
  const hint = section.querySelector("[data-role-hint]");
  if (!kind || !name || !hint) continue;
  let counts = { cast: {}, crew: {} };
  try {
    counts = JSON.parse(section.dataset.roleCounts || "{}");
  } catch {}
  const updateRoleHint = () => {
    const value = name.value.trim().toLocaleLowerCase();
    const count = counts[edition?.value]?.[kind.value]?.[value] || 0;
    hint.textContent = count
      ? `当前已有 ${count} 位队员登记这项${kind.value === "cast" ? "角色；通过后会作为多人饰演或 AB 角共同显示。" : "分工；通过后会作为共同分工显示。"}`
      : "这是新的角色或分工；也可以从已有名称中选择。";
    hint.classList.toggle("role-match", Boolean(count));
  };
  const updateOptions = () => {
    const list = section.querySelector("datalist");
    if (list)
      list.replaceChildren(
        ...Object.keys(counts[edition?.value]?.[kind.value] || {}).map((value) => {
          const option = document.createElement("option");
          option.value = value;
          return option;
        }),
      );
    updateRoleHint();
  };
  edition?.addEventListener("change", updateOptions);
  kind.addEventListener("change", updateOptions);
  updateOptions();
  name.addEventListener("input", updateRoleHint);
}

const themeEditor = document.querySelector("[data-theme-editor]");
const productionColor = document.querySelector("[data-production-color]");
const avatarForm = document.querySelector('form[action="/profile/member/avatar"]');
if (avatarForm) {
  let prepared = false,
    preview;
  const fileInput = avatarForm.querySelector('[name="avatar"]');
  fileInput.addEventListener("change", () => {
    prepared = false;
    preview = undefined;
    fileInput.setCustomValidity("");
  });
  avatarForm.addEventListener("formdata", (event) => {
    if (preview) event.formData.set("avatar_preview", preview, "avatar-preview.jpg");
  });
  avatarForm.addEventListener("submit", async (event) => {
    if (prepared) return;
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file || file.size > 15 * 1024 * 1024) {
      fileInput.setCustomValidity("请选择 15MB 以内的图片。");
      fileInput.reportValidity();
      return;
    }
    fileInput.setCustomValidity("");
    const button = avatarForm.querySelector("button");
    button.disabled = true;
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 32000000) throw new Error("large image");
      const ratio = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f0eee8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      preview = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      if (preview?.size > 512 * 1024) preview = undefined;
    } catch {
      preview = undefined;
    } finally {
      URL.revokeObjectURL(url);
      button.disabled = false;
    }
    prepared = true;
    avatarForm.requestSubmit();
  });
}
if (productionColor) {
  const field = document.querySelector('[name="theme_color"]');
  productionColor.addEventListener("input", () => {
    field.value = productionColor.value;
  });
  field.addEventListener("input", () => {
    if (/^#[0-9a-f]{6}$/i.test(field.value)) productionColor.value = field.value;
  });
}
if (themeEditor) {
  const hex = themeEditor.querySelector('[name="brand_accent"]');
  const picker = themeEditor.querySelector("[data-theme-picker]");
  const status = themeEditor.querySelector("[data-theme-status]");
  const sheet = document.querySelector("#site-theme");
  const initial = hex.value;
  let timer;
  const update = (value) => {
    hex.value = value;
    const valid = /^#[0-9a-f]{6}$/i.test(value);
    hex.setCustomValidity(valid ? "" : "请填写 #RRGGBB 格式");
    status.textContent = valid ? "预览仅你可见，保存页面内容后生效。" : "请填写完整的六位颜色编号。";
    clearTimeout(timer);
    if (valid) {
      picker.value = value;
      timer = setTimeout(() => {
        sheet.href = "/site/theme.css?accent=" + encodeURIComponent(value);
      }, 180);
    }
  };
  hex.addEventListener("input", () => update(hex.value));
  picker.addEventListener("input", () => update(picker.value));
  themeEditor.querySelector("[data-theme-reset]").addEventListener("click", () => update("#ffb547"));
  themeEditor.querySelector("[data-theme-cancel]").addEventListener("click", () => update(initial));
}
document.querySelectorAll("[data-add-edition]").forEach((button) =>
  button.addEventListener("click", () => {
    const container = button.closest("[data-edition-fields]");
    if (container.querySelectorAll("[data-edition-row]").length >= 30) return;
    const row = container.querySelector("[data-edition-row]").cloneNode(true);
    row.querySelector("input").value = "";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary";
    remove.textContent = "移除这一行";
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    button.before(row);
    row.querySelector("input").focus();
  }),
);
document.querySelectorAll("[data-move-resources]").forEach((form) => {
  const target = form.querySelector('[name="edition_id"]');
  const update = () => {
    form.querySelectorAll("[data-source-edition]").forEach((row) => {
      const unavailable = !target.value || row.dataset.sourceEdition === target.value;
      row.hidden = unavailable;
      const checkbox = row.querySelector("input");
      checkbox.disabled = unavailable;
      if (unavailable) checkbox.checked = false;
    });
  };
  target.addEventListener("change", update);
  update();
});

const photoNavigation = document.querySelector("[data-photo-navigation]");
if (photoNavigation) {
  document.addEventListener("keydown", (event) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.target.closest("input,textarea,select,button,a,summary,video,audio,[contenteditable]")
    )
      return;
    const link =
      event.key === "ArrowLeft"
        ? photoNavigation.querySelector("[data-photo-previous]")
        : event.key === "ArrowRight"
          ? photoNavigation.querySelector("[data-photo-next]")
          : null;
    if (link) {
      event.preventDefault();
      location.assign(link.href);
    }
  });
}

const resourceMedia = document.querySelector(".resource-detail-preview>img,.resource-detail-preview>video");
const resourceMediaError = document.querySelector("[data-resource-media-error]");
if (resourceMedia && resourceMediaError) {
  const showResourceMediaError = () => {
    resourceMedia.closest(".resource-detail-preview")?.classList.add("is-unavailable");
    resourceMediaError.hidden = false;
  };
  resourceMedia.addEventListener("error", showResourceMediaError);
  if (resourceMedia instanceof HTMLImageElement && resourceMedia.complete && !resourceMedia.naturalWidth)
    showResourceMediaError();
}

window.blackboxPages?.register("public-controls", (root) => {
  const announcementUpdate = document.querySelector("[data-announcement-update]");
  if (announcementUpdate) {
    const key = `blackbox-announcement-${announcementUpdate.dataset.announcementUser}`;
    const revision = announcementUpdate.dataset.announcementUpdate;
    const badge = announcementUpdate.querySelector("[data-announcement-badge]");
    let seen = false;
    try {
      seen = localStorage.getItem(key) === revision;
    } catch {}
    const show = () => {
      if (badge) badge.hidden = seen;
    };
    show();
    const acknowledge = () => {
      seen = true;
      if (badge) badge.hidden = true;
      try {
        localStorage.setItem(key, revision);
      } catch {}
    };
    announcementUpdate.querySelector("a")?.addEventListener("click", acknowledge);
  }

  for (const mascot of document.querySelectorAll("[data-home-mascot]")) {
    const ready = () => mascot.classList.add("is-ready");
    const missing = () => mascot.classList.add("is-missing");
    mascot.addEventListener("load", ready, { once: true });
    mascot.addEventListener("error", missing, { once: true });
    if (mascot.complete) (mascot.naturalWidth ? ready : missing)();
  }

  const posterDialog = document.querySelector(".poster-dialog");
  const recruitmentImage = document.querySelector(".recruitment-poster img");
  if (recruitmentImage instanceof HTMLImageElement) {
    const updateRatio = () =>
      recruitmentImage
        .closest("figure")
        .classList.toggle("poster-portrait", recruitmentImage.naturalHeight > recruitmentImage.naturalWidth);
    recruitmentImage.addEventListener("load", updateRatio);
    if (recruitmentImage.complete) updateRatio();
  }
  if (posterDialog instanceof HTMLDialogElement) {
    const image = posterDialog.querySelector("img");
    const zoom = posterDialog.querySelector(".poster-zoom");
    document.querySelector("[data-poster-open]")?.addEventListener("click", (event) => {
      event.preventDefault();
      image.src = event.currentTarget.querySelector("img").currentSrc;
      zoom.classList.remove("is-zoomed");
      image.setAttribute("aria-pressed", "false");
      posterDialog.showModal();
    });
    posterDialog.querySelector("[data-poster-close]").addEventListener("click", () => posterDialog.close());
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", "切换海报放大");
    const toggle = () => {
      zoom.classList.toggle("is-zoomed");
      image.setAttribute("aria-pressed", String(zoom.classList.contains("is-zoomed")));
    };
    image.addEventListener("click", toggle);
    image.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }
});

if (["/login", "/profile"].includes(location.pathname)) {
  try {
    localStorage.setItem("blackbox-account-change", String(Date.now()));
  } catch {}
}
document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const action = new URL(form.getAttribute("action") || location.href, location.href);
  if (action.origin !== location.origin || !["/login", "/logout", "/register"].includes(action.pathname)) return;
  try {
    localStorage.setItem("blackbox-account-change", String(Date.now()));
  } catch {}
});
