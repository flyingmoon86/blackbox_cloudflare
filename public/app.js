for (const form of document.querySelectorAll(".batch-credit-form")) {
  const rows = form.querySelector("[data-credit-rows]");
  const initialize = (row) => {
    const select = row.querySelector('[name="member_id"]'),
      input = row.querySelector("[data-member-search]");
    const options = [...select.options].map((o) => o.cloneNode(true));
    input.addEventListener("input", () => {
      const value = select.value,
        q = input.value.trim().toLocaleLowerCase();
      select.replaceChildren(
        ...options
          .filter((o) => !o.value || o.textContent.toLocaleLowerCase().includes(q))
          .map((o) => o.cloneNode(true)),
      );
      select.value = [...select.options].some((o) => o.value === value) ? value : "";
    });
    row.querySelector("[data-remove-credit]").addEventListener("click", () => {
      if (rows.children.length > 1) row.remove();
    });
  };
  rows.querySelectorAll("[data-credit-row]").forEach(initialize);
  form.querySelector("[data-add-credit]").addEventListener("click", () => {
    if (rows.children.length >= 50) return;
    const row = form.querySelector("template").content.firstElementChild.cloneNode(true);
    rows.append(row);
    initialize(row);
    row.querySelector("input").focus();
  });
}

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.dataset.confirm && !window.confirm(form.dataset.confirm))
    event.preventDefault();
});

const importConfirm = document.querySelector("form[data-import-confirm]");
if (importConfirm instanceof HTMLFormElement) {
  const panel = importConfirm.querySelector(".import-commit-progress");
  const meter = panel?.querySelector("progress");
  const message = panel?.querySelector("[data-import-message]");
  const checkLink = panel?.querySelector("[data-import-check]");
  const submit = importConfirm.querySelector('button[type="submit"],button:not([type])');
  const batchUrl = new URL(importConfirm.action).pathname.replace(/\/confirm$/, "");
  let pending = false;
  let finished = false;
  let pollTimer;
  const showResult = () => {
    if (finished) return;
    finished = true;
    clearInterval(pollTimer);
    meter.value = 1;
    message.textContent = "数据库已确认导入完成，正在打开结果。";
    location.assign(batchUrl);
  };
  const status = async () => {
    const response = await fetch(importConfirm.dataset.statusUrl, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) return null;
    return response.json();
  };
  importConfirm.addEventListener("submit", async (event) => {
    if (!panel || !meter || !message || !checkLink || !submit) return;
    if (pending) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    pending = true;
    submit.disabled = true;
    panel.hidden = false;
    panel.scrollIntoView({ block: "center" });
    checkLink.hidden = true;
    meter.removeAttribute("value");
    message.textContent = "正在提交整批数据，完成前无法显示逐行百分比。";
    pollTimer = setInterval(async () => {
      if (finished) return;
      try {
        if ((await status())?.status === "committed") showResult();
      } catch {}
    }, 3000);
    const waiting = setTimeout(() => {
      if (!finished) {
        message.textContent = "仍在等待服务器确认。请勿重复提交；可以打开批次页核对结果。";
        checkLink.hidden = false;
      }
    }, 8000);
    try {
      const response = await fetch(importConfirm.action, {
        method: "POST",
        body: new FormData(importConfirm),
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (finished) return;
      if (response.ok && !response.redirected && response.headers.get("Content-Type")?.includes("application/json")) {
        const result = await response.json();
        if (result.status === "committed") return showResult();
      }
      message.textContent =
        response.status === 409
          ? "批次或档案已变化，未确认入库。请打开批次页核对。"
          : "服务器未确认提交结果。请打开批次页核对，不要直接重试。";
    } catch {
      if (finished) return;
      try {
        if ((await status())?.status === "committed") return showResult();
      } catch {}
      message.textContent = "网络中断，提交结果尚未确认。请打开批次页核对，不要直接重试。";
    } finally {
      clearTimeout(waiting);
      if (!finished) {
        clearInterval(pollTimer);
        checkLink.hidden = false;
      }
    }
  });
}

const notice = document.querySelector("[data-test-notice]");
if (notice instanceof HTMLDialogElement && !document.querySelector("[data-stage-preview]")) {
  const key = `blackbox-test-notice-${notice.dataset.testNotice}`;
  let understood = false;
  try {
    understood = localStorage.getItem(key) === "understood";
  } catch {}
  if (!understood) notice.showModal();
  notice.addEventListener("close", () => {
    if (notice.returnValue === "understood") {
      try {
        localStorage.setItem(key, "understood");
      } catch {}
    }
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
  let running = false,
    timer,
    signature = "",
    lastAttempt = 0,
    lastFailure = "";
  function workbenchStatus(state, data) {
    const workbench = document.querySelector("[data-workbench]");
    if (!workbench) return;
    const status = workbench.querySelector("[data-workbench-sync]");
    status.dataset.state = state;
    if (state === "loading") status.textContent = "正在同步待办数量，当前内容仍可查看…";
    if (state === "error") status.textContent = "待办同步失败，保留上次数量；请使用页眉重试，或刷新工作台核对。";
    if (state === "ok") {
      const counts = new Map((data.pending || []).map((item) => [item.key.split(":")[0], Number(item.count) || 0]));
      for (const badge of workbench.querySelectorAll("[data-workbench-count]")) {
        badge.textContent = badge.dataset.workbenchCount
          .split(",")
          .reduce((sum, kind) => sum + (counts.get(kind) || 0), 0);
      }
      workbench.querySelector("[data-workbench-total]").textContent = Number(data.pendingTotal) || 0;
      workbench.querySelector("[data-workbench-empty]").hidden = Boolean(data.pendingTotal);
      status.textContent =
        "数量更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false }) + "；新申请请刷新查看。";
    }
  }
  async function notificationJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      ...options,
      headers: { accept: "application/json", ...options.headers },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || response.redirected || !contentType.includes("application/json")) {
      const error = new Error("后台待办请求未返回有效 JSON");
      error.status = response.status;
      error.kind = response.status === 401 || response.status === 403 || response.redirected ? "auth" : "request";
      throw error;
    }
    try {
      return await response.json();
    } catch {
      const error = new Error("后台待办响应无法解析");
      error.status = response.status;
      error.kind = "parse";
      throw error;
    }
  }
  function clearNotificationFailure() {
    notificationHost.querySelector("[data-notification-status]")?.remove();
    lastFailure = "";
  }
  function showNotificationFailure(error) {
    const statusCode = Number(error?.status) || 0;
    const kind = error?.kind || (error?.name === "TimeoutError" ? "timeout" : "network");
    const failure = `${kind}:${statusCode}`;
    if (failure !== lastFailure) {
      console.warn("后台待办同步失败", { kind, status: statusCode || undefined });
      lastFailure = failure;
    }
    notificationHost.querySelector("[data-notification-status]")?.remove();
    const status = document.createElement("div");
    status.className = "admin-notification-status";
    status.dataset.notificationStatus = kind;
    status.setAttribute("role", "status");
    const message = document.createElement("span");
    message.textContent =
      kind === "auth" ? "登录状态已失效" : `待办同步失败${statusCode ? `（HTTP ${statusCode}）` : ""}`;
    const action = document.createElement(kind === "auth" ? "a" : "button");
    if (action instanceof HTMLAnchorElement) {
      action.href = "/login?next=/admin";
      action.textContent = "重新登录";
    } else {
      action.type = "button";
      action.textContent = "重试";
      action.addEventListener("click", refreshNotifications);
    }
    status.append(message, action);
    notificationHost.append(status);
  }
  async function refreshNotifications() {
    if (running || document.hidden) return;
    clearTimeout(timer);
    running = true;
    lastAttempt = Date.now();
    workbenchStatus("loading");
    try {
      const data = await notificationJson("/admin/notifications", {
        signal: AbortSignal.timeout(15000),
      });
      clearNotificationFailure();
      workbenchStatus("ok", data);
      const count = Number(data.pendingTotal) || 0;
      const alert = document.querySelector("[data-pending-alert]");
      if (alert) {
        alert.hidden = !count;
        alert.querySelector("[data-pending-message]").textContent = `有 ${count} 项任务等待处理`;
        alert.querySelector("[data-pending-link]").href = data.pending?.[0]?.href || "/admin";
      }
      const current = JSON.stringify([data.pending, data.items]);
      if (current === signature) return;
      signature = current;
      notificationHost.replaceChildren();
      if (count && !document.querySelector("[data-workbench]")) {
        const persistent = document.createElement("a");
        persistent.className = "admin-pending-indicator";
        persistent.href = "/admin";
        persistent.textContent = `${count} 项待办`;
        persistent.setAttribute("aria-label", `还有 ${count} 项管理员任务未处理`);
        notificationHost.append(persistent);
      }
      if (!data.items?.length) return;
      const details = document.createElement("details");
      details.className = "admin-notification-menu";
      // Keep navigation and task controls clear; the reminder remains available in the header.
      details.open =
        !document.body.classList.contains("admin-workspace") && !data.items.every((item) => item.informational);
      const summary = document.createElement("summary");
      summary.textContent = data.items.some((item) => item.informational) ? "新提醒" : "新任务";
      const stack = document.createElement("div");
      stack.className = "notification-stack";
      for (const item of data.items) {
        const card = document.createElement("article");
        card.className = "notification-card";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = item.title;
        const description = document.createElement("span");
        description.textContent = item.informational
          ? `近 7 天 ${item.count} 条导入/撤销记录`
          : `${item.count} 项等待处理`;
        copy.append(title, description);
        const action = document.createElement("button");
        action.type = "button";
        action.className = "small notification-action";
        action.textContent = item.informational ? "查看 →" : "处理 →";
        action.addEventListener("click", async () => {
          action.disabled = true;
          try {
            await notificationJson("/admin/notifications/dismiss", {
              method: "POST",
              body: new URLSearchParams({ csrf: data.csrf, key: item.key }),
              signal: AbortSignal.timeout(15000),
            });
            location.assign(item.href);
          } catch (error) {
            action.disabled = false;
            description.textContent = "提醒状态未确认，请刷新核对或稍后再试";
            showNotificationFailure(error);
          }
        });
        card.append(copy, action);
        stack.append(card);
      }
      if (data.hidden) {
        const more = document.createElement("a");
        more.href = "/admin";
        more.className = "notification-more";
        more.textContent = `还有 ${data.hidden} 类待办，查看全部 →`;
        stack.append(more);
      }
      details.append(summary, stack);
      notificationHost.append(details);
    } catch (error) {
      workbenchStatus("error");
      showNotificationFailure(error);
    } finally {
      running = false;
      if (!document.hidden) timer = setTimeout(refreshNotifications, 60000);
    }
  }
  refreshNotifications();
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (!document.hidden) {
      if (Date.now() - lastAttempt > 5000) refreshNotifications();
      else timer = setTimeout(refreshNotifications, 5000);
    }
  });
  document.addEventListener("blackbox:reviewed", () => {
    clearTimeout(timer);
    timer = setTimeout(refreshNotifications, 600);
  });
}

const announcementUpdate = document.querySelector("[data-announcement-update]");
if (announcementUpdate) {
  const key = `blackbox-announcement-${announcementUpdate.dataset.announcementUser}`;
  const revision = announcementUpdate.dataset.announcementUpdate;
  let seen = false;
  try {
    seen = localStorage.getItem(key) === revision;
  } catch {}
  const show = () => {
    if (!seen) announcementUpdate.hidden = false;
  };
  if (notice instanceof HTMLDialogElement && notice.open) notice.addEventListener("close", show, { once: true });
  else show();
  const acknowledge = () => {
    seen = true;
    announcementUpdate.hidden = true;
    try {
      localStorage.setItem(key, revision);
    } catch {}
  };
  announcementUpdate.querySelector("[data-announcement-read]").addEventListener("click", acknowledge);
  announcementUpdate.querySelector("[data-announcement-dismiss]").addEventListener("click", acknowledge);
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

for (const mascot of document.querySelectorAll("[data-home-mascot]")) {
  const ready = () => mascot.classList.add("is-ready");
  const missing = () => mascot.classList.add("is-missing");
  mascot.addEventListener("load", ready, { once: true });
  mascot.addEventListener("error", missing, { once: true });
  if (mascot.complete) (mascot.naturalWidth ? ready : missing)();
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
