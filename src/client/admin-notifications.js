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
