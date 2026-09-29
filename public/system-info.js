const legacySections = { "#system-flows": "flows", "#system-database": "database", "#system-storage": "storage" };
if (["/admin/system", "/admin/system/architecture"].includes(location.pathname) && legacySections[location.hash]) {
  location.replace("/admin/system/" + legacySections[location.hash]);
}
const root = document.querySelector("#system-live");
const status = document.querySelector("#system-status");
const refresh = document.querySelector("#system-refresh");
if (root && status && refresh) {
  const load = async () => {
    refresh.disabled = true;
    root.replaceChildren();
    root.setAttribute("aria-busy", "true");
    status.textContent =
      "正在加载" +
      ({ database: "数据库结构", storage: "存储状态", architecture: "连接状态" }[root.dataset?.systemSection] ||
        "数据库结构与存储状态") +
      "…";
    try {
      const response = await fetch(
        "/admin/system/data" +
          (root.dataset?.systemSection ? "?section=" + encodeURIComponent(root.dataset.systemSection) : ""),
        {
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
      );
      if (response.status === 401 || response.status === 403) {
        status.textContent = "登录已失效或没有管理员权限，请使用管理员账号重新登录。";
        return;
      }
      if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) throw Error();
      // Same-origin, admin-only HTML fragment; every dynamic value is escaped on the server.
      root.innerHTML = await response.text();
      status.textContent = root.querySelector('[role="alert"]')
        ? "部分查询失败，其余结果已显示，可刷新重试。"
        : "只读信息已更新。";
    } catch {
      status.textContent = "查询失败或会话已失效，请检查网络、重新登录后刷新重试。";
    } finally {
      root.setAttribute("aria-busy", "false");
      refresh.disabled = false;
    }
  };
  refresh.addEventListener("click", load);
  void load();
}
