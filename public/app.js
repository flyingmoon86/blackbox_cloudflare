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
