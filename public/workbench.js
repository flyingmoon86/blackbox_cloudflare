// Keep old bookmarks and notification links useful after splitting the workbench.
if (location.pathname === "/admin" && ["#accounts", "#member-requests"].includes(location.hash)) {
  location.replace((location.hash === "#accounts" ? "/admin/accounts" : "/admin/member-requests") + location.search);
}
// Navigation and filtering only. All forms continue to use the original authenticated routes.
const workspaceNavigation = document.querySelector(".workspace-navigation");
if (workspaceNavigation) {
  const mobile = matchMedia("(max-width: 1000px)");
  const adaptNavigation = () => {
    workspaceNavigation.open = !mobile.matches;
  };
  adaptNavigation();
  mobile.addEventListener("change", adaptNavigation);
}
function revealWorkspaceAnchor() {
  const id = location.hash.slice(1);
  if (!["accounts", "member-requests", "archive-tools"].includes(id)) return;
  const target = document.getElementById(id);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ block: "start" });
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
window.addEventListener("hashchange", revealWorkspaceAnchor);
revealWorkspaceAnchor();
const accountQuery = document.querySelector("[data-account-query]");
if (accountQuery) {
  const rows = [...document.querySelectorAll("[data-account-search]")];
  const count = document.querySelector("[data-account-count]");
  document.querySelector("[data-account-tools]").hidden = false;
  const filterAccounts = () => {
    const query = accountQuery.value.trim().toLocaleLowerCase();
    for (const row of rows)
      row.hidden = !`${row.dataset.accountSearch} ${row.textContent}`.toLocaleLowerCase().includes(query);
    const shown = rows.filter((row) => !row.hidden).length;
    count.textContent = `显示 ${shown} / ${rows.length} 个账号${shown ? "" : "，没有匹配项，请调整或清空关键词。"}`;
  };
  accountQuery.addEventListener("input", filterAccounts);
  filterAccounts();
}
