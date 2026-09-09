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
