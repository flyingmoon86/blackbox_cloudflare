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
