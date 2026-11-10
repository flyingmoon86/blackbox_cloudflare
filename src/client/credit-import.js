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

// Keep unsaved match choices across the existing GET search within this tab.
const importDraft = document.querySelector("form.import-review[data-draft-batch]");
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
  } catch {}
  try {
    const saved = JSON.parse(storage?.getItem(draftKey) || "null");
    if (saved?.revision === revision) {
      for (const select of choices) {
        const item = saved.choices?.[select.name];
        if (!item || !/^(keep|auto|create|skip|match:\d+)$/.test(item.value)) continue;
        if (![...select.options].some((o) => o.value === item.value) && /^match:\d+$/.test(item.value))
          select.add(new Option(String(item.label || "暂存的关联档案").slice(0, 150), item.value));
        select.value = item.value;
      }
      notice.textContent = "已恢复本标签页未提交的选择，请保存并重新检查。";
    } else if (saved) storage.removeItem(draftKey);
  } catch {}
  importDraft.addEventListener("change", () => {
    const values = Object.fromEntries(
      choices.map((s) => [s.name, { value: s.value, label: s.selectedOptions[0]?.textContent || "" }]),
    );
    try {
      if (!storage) throw Error();
      storage.setItem(draftKey, JSON.stringify({ revision, choices: values }));
      notice.textContent = "选择已在本标签页暂存；点击保存后生效。";
    } catch {
      notice.textContent = "浏览器无法暂存选择，请先保存再搜索或离开。";
    }
  });
}
