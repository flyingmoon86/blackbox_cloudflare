// Generated from src/client/credit-import.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/credit-import.js
  var importConfirm = document.querySelector("form[data-import-confirm]");
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
      message.textContent = "\u6570\u636E\u5E93\u5DF2\u786E\u8BA4\u5BFC\u5165\u5B8C\u6210\uFF0C\u6B63\u5728\u6253\u5F00\u7ED3\u679C\u3002";
      location.assign(batchUrl);
    };
    const status = async () => {
      const response = await fetch(importConfirm.dataset.statusUrl, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store"
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
      message.textContent = "\u6B63\u5728\u63D0\u4EA4\u6574\u6279\u6570\u636E\uFF0C\u5B8C\u6210\u524D\u65E0\u6CD5\u663E\u793A\u9010\u884C\u767E\u5206\u6BD4\u3002";
      pollTimer = setInterval(async () => {
        if (finished) return;
        try {
          if ((await status())?.status === "committed") showResult();
        } catch {
        }
      }, 3e3);
      const waiting = setTimeout(() => {
        if (!finished) {
          message.textContent = "\u4ECD\u5728\u7B49\u5F85\u670D\u52A1\u5668\u786E\u8BA4\u3002\u8BF7\u52FF\u91CD\u590D\u63D0\u4EA4\uFF1B\u53EF\u4EE5\u6253\u5F00\u6279\u6B21\u9875\u6838\u5BF9\u7ED3\u679C\u3002";
          checkLink.hidden = false;
        }
      }, 8e3);
      try {
        const response = await fetch(importConfirm.action, {
          method: "POST",
          body: new FormData(importConfirm),
          headers: { Accept: "application/json" },
          credentials: "same-origin"
        });
        if (finished) return;
        if (response.ok && !response.redirected && response.headers.get("Content-Type")?.includes("application/json")) {
          const result = await response.json();
          if (result.status === "committed") return showResult();
        }
        message.textContent = response.status === 409 ? "\u6279\u6B21\u6216\u6863\u6848\u5DF2\u53D8\u5316\uFF0C\u672A\u786E\u8BA4\u5165\u5E93\u3002\u8BF7\u6253\u5F00\u6279\u6B21\u9875\u6838\u5BF9\u3002" : "\u670D\u52A1\u5668\u672A\u786E\u8BA4\u63D0\u4EA4\u7ED3\u679C\u3002\u8BF7\u6253\u5F00\u6279\u6B21\u9875\u6838\u5BF9\uFF0C\u4E0D\u8981\u76F4\u63A5\u91CD\u8BD5\u3002";
      } catch {
        if (finished) return;
        try {
          if ((await status())?.status === "committed") return showResult();
        } catch {
        }
        message.textContent = "\u7F51\u7EDC\u4E2D\u65AD\uFF0C\u63D0\u4EA4\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002\u8BF7\u6253\u5F00\u6279\u6B21\u9875\u6838\u5BF9\uFF0C\u4E0D\u8981\u76F4\u63A5\u91CD\u8BD5\u3002";
      } finally {
        clearTimeout(waiting);
        if (!finished) {
          clearInterval(pollTimer);
          checkLink.hidden = false;
        }
      }
    });
  }
  var importDraft = document.querySelector("form.import-review[data-draft-batch]");
  if (importDraft) {
    const draftKey = `blackbox-import-draft:${importDraft.dataset.draftOwner}:${importDraft.dataset.draftBatch}`;
    const revision = importDraft.dataset.draftRevision;
    const choices = [...importDraft.querySelectorAll('select[name^="decision_"]')];
    const notice = document.createElement("p");
    notice.className = "hint";
    notice.setAttribute("role", "status");
    importDraft.prepend(notice);
    let storage;
    try {
      storage = sessionStorage;
    } catch {
    }
    try {
      const saved = JSON.parse(storage?.getItem(draftKey) || "null");
      if (saved?.revision === revision) {
        for (const select of choices) {
          const item = saved.choices?.[select.name];
          if (!item || !/^(keep|auto|create|skip|match:\d+)$/.test(item.value)) continue;
          if (![...select.options].some((o) => o.value === item.value) && /^match:\d+$/.test(item.value))
            select.add(new Option(String(item.label || "\u6682\u5B58\u7684\u5173\u8054\u6863\u6848").slice(0, 150), item.value));
          select.value = item.value;
        }
        notice.textContent = "\u5DF2\u6062\u590D\u672C\u6807\u7B7E\u9875\u672A\u63D0\u4EA4\u7684\u9009\u62E9\uFF0C\u8BF7\u4FDD\u5B58\u5E76\u91CD\u65B0\u68C0\u67E5\u3002";
      } else if (saved) storage.removeItem(draftKey);
    } catch {
    }
    importDraft.addEventListener("change", () => {
      const values = Object.fromEntries(
        choices.map((s) => [s.name, { value: s.value, label: s.selectedOptions[0]?.textContent || "" }])
      );
      try {
        if (!storage) throw Error();
        storage.setItem(draftKey, JSON.stringify({ revision, choices: values }));
        notice.textContent = "\u9009\u62E9\u5DF2\u5728\u672C\u6807\u7B7E\u9875\u6682\u5B58\uFF1B\u70B9\u51FB\u4FDD\u5B58\u540E\u751F\u6548\u3002";
      } catch {
        notice.textContent = "\u6D4F\u89C8\u5668\u65E0\u6CD5\u6682\u5B58\u9009\u62E9\uFF0C\u8BF7\u5148\u4FDD\u5B58\u518D\u641C\u7D22\u6216\u79BB\u5F00\u3002";
      }
    });
  }
})();
