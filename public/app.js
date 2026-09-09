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

for (const button of document.querySelectorAll("[data-copy-contact]")) {
  button.addEventListener("click", async () => {
    const value = button.dataset.copyContact || "";
    const feedback = button.closest(".contact-actions")?.querySelector("[data-copy-feedback]");
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (feedback) feedback.textContent = "邮箱已复制";
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (feedback) feedback.textContent = copied ? "邮箱已复制" : "复制失败，请长按邮箱复制";
    }
  });
}
