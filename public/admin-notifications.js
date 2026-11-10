// Generated from src/client/admin-notifications.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/admin-notifications.js
  var notificationHost = document.querySelector("[data-admin-notifications]");
  if (notificationHost) {
    let workbenchStatus2 = function(state, data) {
      const workbench = document.querySelector("[data-workbench]");
      if (!workbench) return;
      const status = workbench.querySelector("[data-workbench-sync]");
      status.dataset.state = state;
      if (state === "loading") status.textContent = "\u6B63\u5728\u540C\u6B65\u5F85\u529E\u6570\u91CF\uFF0C\u5F53\u524D\u5185\u5BB9\u4ECD\u53EF\u67E5\u770B\u2026";
      if (state === "error") status.textContent = "\u5F85\u529E\u540C\u6B65\u5931\u8D25\uFF0C\u4FDD\u7559\u4E0A\u6B21\u6570\u91CF\uFF1B\u8BF7\u4F7F\u7528\u9875\u7709\u91CD\u8BD5\uFF0C\u6216\u5237\u65B0\u5DE5\u4F5C\u53F0\u6838\u5BF9\u3002";
      if (state === "ok") {
        const counts = new Map((data.pending || []).map((item) => [item.key.split(":")[0], Number(item.count) || 0]));
        for (const badge of workbench.querySelectorAll("[data-workbench-count]")) {
          badge.textContent = badge.dataset.workbenchCount.split(",").reduce((sum, kind) => sum + (counts.get(kind) || 0), 0);
        }
        workbench.querySelector("[data-workbench-total]").textContent = Number(data.pendingTotal) || 0;
        workbench.querySelector("[data-workbench-empty]").hidden = Boolean(data.pendingTotal);
        status.textContent = "\u6570\u91CF\u66F4\u65B0\u4E8E " + (/* @__PURE__ */ new Date()).toLocaleTimeString("zh-CN", { hour12: false }) + "\uFF1B\u65B0\u7533\u8BF7\u8BF7\u5237\u65B0\u67E5\u770B\u3002";
      }
    }, clearNotificationFailure2 = function() {
      notificationHost.querySelector("[data-notification-status]")?.remove();
      lastFailure = "";
    }, showNotificationFailure2 = function(error) {
      const statusCode = Number(error?.status) || 0;
      const kind = error?.kind || (error?.name === "TimeoutError" ? "timeout" : "network");
      const failure = `${kind}:${statusCode}`;
      if (failure !== lastFailure) {
        console.warn("\u540E\u53F0\u5F85\u529E\u540C\u6B65\u5931\u8D25", { kind, status: statusCode || void 0 });
        lastFailure = failure;
      }
      notificationHost.querySelector("[data-notification-status]")?.remove();
      const status = document.createElement("div");
      status.className = "admin-notification-status";
      status.dataset.notificationStatus = kind;
      status.setAttribute("role", "status");
      const message = document.createElement("span");
      message.textContent = kind === "auth" ? "\u767B\u5F55\u72B6\u6001\u5DF2\u5931\u6548" : `\u5F85\u529E\u540C\u6B65\u5931\u8D25${statusCode ? `\uFF08HTTP ${statusCode}\uFF09` : ""}`;
      const action = document.createElement(kind === "auth" ? "a" : "button");
      if (action instanceof HTMLAnchorElement) {
        action.href = "/login?next=/admin";
        action.textContent = "\u91CD\u65B0\u767B\u5F55";
      } else {
        action.type = "button";
        action.textContent = "\u91CD\u8BD5";
        action.addEventListener("click", refreshNotifications);
      }
      status.append(message, action);
      notificationHost.append(status);
    };
    workbenchStatus = workbenchStatus2, clearNotificationFailure = clearNotificationFailure2, showNotificationFailure = showNotificationFailure2;
    let running = false, timer, signature = "", lastAttempt = 0, lastFailure = "";
    async function notificationJson(url, options = {}) {
      const response = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers: { accept: "application/json", ...options.headers }
      });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || response.redirected || !contentType.includes("application/json")) {
        const error = new Error("\u540E\u53F0\u5F85\u529E\u8BF7\u6C42\u672A\u8FD4\u56DE\u6709\u6548 JSON");
        error.status = response.status;
        error.kind = response.status === 401 || response.status === 403 || response.redirected ? "auth" : "request";
        throw error;
      }
      try {
        return await response.json();
      } catch {
        const error = new Error("\u540E\u53F0\u5F85\u529E\u54CD\u5E94\u65E0\u6CD5\u89E3\u6790");
        error.status = response.status;
        error.kind = "parse";
        throw error;
      }
    }
    async function refreshNotifications() {
      if (running || document.hidden) return;
      clearTimeout(timer);
      running = true;
      lastAttempt = Date.now();
      workbenchStatus2("loading");
      try {
        const data = await notificationJson("/admin/notifications", {
          signal: AbortSignal.timeout(15e3)
        });
        clearNotificationFailure2();
        workbenchStatus2("ok", data);
        const count = Number(data.pendingTotal) || 0;
        const alert = document.querySelector("[data-pending-alert]");
        if (alert) {
          alert.hidden = !count;
          alert.querySelector("[data-pending-message]").textContent = `\u6709 ${count} \u9879\u4EFB\u52A1\u7B49\u5F85\u5904\u7406`;
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
          persistent.textContent = `${count} \u9879\u5F85\u529E`;
          persistent.setAttribute("aria-label", `\u8FD8\u6709 ${count} \u9879\u7BA1\u7406\u5458\u4EFB\u52A1\u672A\u5904\u7406`);
          notificationHost.append(persistent);
        }
        if (!data.items?.length) return;
        const details = document.createElement("details");
        details.className = "admin-notification-menu";
        details.open = !document.body.classList.contains("admin-workspace") && !data.items.every((item) => item.informational);
        const summary = document.createElement("summary");
        summary.textContent = data.items.some((item) => item.informational) ? "\u65B0\u63D0\u9192" : "\u65B0\u4EFB\u52A1";
        const stack = document.createElement("div");
        stack.className = "notification-stack";
        for (const item of data.items) {
          const card = document.createElement("article");
          card.className = "notification-card";
          const copy = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = item.title;
          const description = document.createElement("span");
          description.textContent = item.informational ? `\u8FD1 7 \u5929 ${item.count} \u6761\u5BFC\u5165/\u64A4\u9500\u8BB0\u5F55` : `${item.count} \u9879\u7B49\u5F85\u5904\u7406`;
          copy.append(title, description);
          const action = document.createElement("button");
          action.type = "button";
          action.className = "small notification-action";
          action.textContent = item.informational ? "\u67E5\u770B \u2192" : "\u5904\u7406 \u2192";
          action.addEventListener("click", async () => {
            action.disabled = true;
            try {
              await notificationJson("/admin/notifications/dismiss", {
                method: "POST",
                body: new URLSearchParams({ csrf: data.csrf, key: item.key }),
                signal: AbortSignal.timeout(15e3)
              });
              location.assign(item.href);
            } catch (error) {
              action.disabled = false;
              description.textContent = "\u63D0\u9192\u72B6\u6001\u672A\u786E\u8BA4\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\u6216\u7A0D\u540E\u518D\u8BD5";
              showNotificationFailure2(error);
            }
          });
          card.append(copy, action);
          stack.append(card);
        }
        if (data.hidden) {
          const more = document.createElement("a");
          more.href = "/admin";
          more.className = "notification-more";
          more.textContent = `\u8FD8\u6709 ${data.hidden} \u7C7B\u5F85\u529E\uFF0C\u67E5\u770B\u5168\u90E8 \u2192`;
          stack.append(more);
        }
        details.append(summary, stack);
        notificationHost.append(details);
      } catch (error) {
        workbenchStatus2("error");
        showNotificationFailure2(error);
      } finally {
        running = false;
        if (!document.hidden) timer = setTimeout(refreshNotifications, 6e4);
      }
    }
    refreshNotifications();
    document.addEventListener("visibilitychange", () => {
      clearTimeout(timer);
      if (!document.hidden) {
        if (Date.now() - lastAttempt > 5e3) refreshNotifications();
        else timer = setTimeout(refreshNotifications, 5e3);
      }
    });
    document.addEventListener("blackbox:reviewed", () => {
      clearTimeout(timer);
      timer = setTimeout(refreshNotifications, 600);
    });
  }
  var workbenchStatus;
  var clearNotificationFailure;
  var showNotificationFailure;
})();
