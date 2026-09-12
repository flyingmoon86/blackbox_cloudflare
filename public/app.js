document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm))
    event.preventDefault();
});

const notice = document.querySelector("[data-test-notice]");
if (notice instanceof HTMLDialogElement) {
  const key = `blackbox-test-notice-${notice.dataset.testNotice}`;
  if (localStorage.getItem(key) !== "understood") notice.showModal();
  notice.addEventListener("close", () => {
    if (notice.returnValue === "understood") localStorage.setItem(key, "understood");
  });
}

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

const notificationHost = document.querySelector("[data-admin-notifications]");
if (notificationHost) {
  fetch("/admin/notifications", { headers: { accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("notification request failed");
      return response.json();
    })
    .then((data) => {
      if (!Array.isArray(data.items) || !data.items.length) return;
      const details = document.createElement("details");
      details.className = "admin-notification-menu";
      details.open = true;
      const summary = document.createElement("summary");
      summary.innerHTML = `<span aria-hidden="true">●</span><span>待处理</span><strong>${data.total}</strong>`;
      const stack = document.createElement("div");
      stack.className = "notification-stack";
      for (const item of data.items) {
        const card = document.createElement("article");
        card.className = "notification-card";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.title;
        const description = document.createElement("span");
        description.textContent = `${item.count} 项等待处理`;
        copy.append(title, description);
        const action = document.createElement("button");
        action.type = "button";
        action.className = "small notification-action";
        action.textContent = "处理 →";
        action.addEventListener("click", async () => {
          action.disabled = true;
          const body = new URLSearchParams({ csrf: data.csrf, key: item.key });
          const response = await fetch("/admin/notifications/dismiss", { method: "POST", body });
          if (response.ok) {
            card.remove();
            location.assign(item.href);
          } else {
            action.disabled = false;
            description.textContent = "操作失败，请刷新后再试";
          }
        });
        card.append(copy, action);
        stack.append(card);
      }
      if (data.hidden) {
        const more = document.createElement("a");
        more.className = "notification-more";
        more.href = "/admin";
        more.textContent = `还有 ${data.hidden} 类待办，前往工作台查看`;
        stack.append(more);
      }
      details.append(summary, stack);
      notificationHost.append(details);
    })
    .catch(() => {});
}

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

for (const section of document.querySelectorAll("[data-role-counts]")) {
  const kind = section.querySelector("[data-role-kind]");
  const name = section.querySelector("[data-role-name]");
  const hint = section.querySelector("[data-role-hint]");
  if (!kind || !name || !hint) continue;
  let counts = { cast: {}, crew: {} };
  try {
    counts = JSON.parse(section.dataset.roleCounts || "{}");
  } catch {}
  const updateRoleHint = () => {
    const value = name.value.trim().toLocaleLowerCase();
    const count = counts[kind.value]?.[value] || 0;
    hint.textContent = count
      ? `当前已有 ${count} 位队员登记这项${kind.value === "cast" ? "角色；通过后会作为多人饰演或 AB 角共同显示。" : "分工；通过后会作为共同分工显示。"}`
      : "这是新的角色或分工；也可以从已有名称中选择。";
    hint.classList.toggle("role-match", Boolean(count));
  };
  kind.addEventListener("change", updateRoleHint);
  name.addEventListener("input", updateRoleHint);
}

for (const mascot of document.querySelectorAll("[data-home-mascot]")) {
  const ready = () => mascot.classList.add("is-ready");
  const missing = () => mascot.classList.add("is-missing");
  mascot.addEventListener("load", ready, { once: true });
  mascot.addEventListener("error", missing, { once: true });
  if (mascot.complete) (mascot.naturalWidth ? ready : missing)();
}

const themeEditor = document.querySelector("[data-theme-editor]");
if (themeEditor) {
  const hex = themeEditor.querySelector("[data-theme-hex]");
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
  themeEditor.querySelector("[data-theme-reset]").addEventListener("click", () => update("#536c57"));
  themeEditor.querySelector("[data-theme-cancel]").addEventListener("click", () => update(initial));
}
const posterSelectors = document.querySelectorAll("[data-poster-select]");
function updatePosterPreviews() {
  const general = document.querySelector('[name="recruitment_poster"]')?.value;
  for (const img of document.querySelectorAll("[data-poster-preview]")) {
    const own = document.querySelector('[name="' + img.dataset.posterPreview + '"]')?.value;
    const id = own || general;
    img.hidden = !id;
    if (id) img.src = "/resources/" + encodeURIComponent(id) + "/preview";
    else img.removeAttribute("src");
  }
}
posterSelectors.forEach((select) => select.addEventListener("change", updatePosterPreviews));
if (posterSelectors.length) updatePosterPreviews();
const posterDialog = document.querySelector(".poster-dialog");
if (posterDialog instanceof HTMLDialogElement) {
  const image = posterDialog.querySelector("img");
  const zoom = posterDialog.querySelector(".poster-zoom");
  document.querySelector("[data-poster-open]")?.addEventListener("click", (event) => {
    event.preventDefault();
    image.src = event.currentTarget.querySelector("img").currentSrc;
    zoom.classList.remove("is-zoomed");
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
