// Progressive enhancement: native forms and server authorization remain authoritative.
document.querySelectorAll("[data-review-queue]").forEach((queue) => {
  const kind = queue.dataset.reviewQueue;
  const key = `blackbox-review-v1:${queue.dataset.reviewOwner}:${location.pathname}:${kind}`;
  const read = (storage, name) => {
    try {
      return JSON.parse(storage.getItem(name) || "null");
    } catch {
      return null;
    }
  };
  const write = (storage, name, value) => {
    try {
      value === null ? storage.removeItem(name) : storage.setItem(name, JSON.stringify(value));
    } catch {}
  };
  // Access to storage itself can throw in privacy-restricted browsers.
  let savedStorage, progressStorage;
  try {
    savedStorage = localStorage;
    progressStorage = sessionStorage;
  } catch {}
  let cards = [...queue.querySelectorAll("[data-review-id]")];
  const query = queue.querySelector("[data-review-query]");
  const filter = queue.querySelector("[data-review-filter]");
  const count = queue.querySelector("[data-review-count]");
  const feedback = queue.querySelector("[data-review-feedback]");
  const stored = read(savedStorage, key);
  for (const category of new Set(cards.map((card) => card.dataset.reviewCategory))) {
    filter.add(new Option(category, category));
  }
  // Preserve a saved category even when its last pending item was just processed.
  if (
    typeof stored?.category === "string" &&
    stored.category.length <= 80 &&
    ![...filter.options].some((option) => option.value === stored.category)
  )
    filter.add(new Option(stored.category, stored.category));
  query.value = typeof stored?.query === "string" ? stored.query.slice(0, 100) : "";
  filter.value = typeof stored?.category === "string" ? stored.category : "";
  const apply = () => {
    feedback.hidden = true;
    const term = query.value.trim().toLocaleLowerCase();
    for (const card of cards)
      card.hidden = Boolean(
        (filter.value && card.dataset.reviewCategory !== filter.value) ||
        (term && !card.dataset.reviewSearch.toLocaleLowerCase().includes(term)),
      );
    const shown = cards.filter((card) => !card.hidden).length;
    count.textContent =
      `显示 ${shown} / ${cards.length} 条待办` +
      (shown === 0 && cards.length ? "，没有匹配项，可清除筛选查看其余待办。" : "");
    write(savedStorage, key, { query: query.value, category: filter.value });
  };
  query.addEventListener("input", apply);
  filter.addEventListener("change", apply);
  queue.querySelector("[data-review-clear]").addEventListener("click", () => {
    query.value = "";
    filter.value = "";
    apply();
    query.focus();
  });
  queue.querySelector(".review-tools").hidden = false;
  apply();
  const reasons = {
    resource: [
      "请补充准确的作品及演出版本信息。",
      "文件内容不完整或无法正常打开，请检查后重新上传。",
      "资料说明不足，请补充内容来源及用途。",
    ],
    production: [
      "请核对演出版本和角色或分工后重新提交。",
      "现有信息不足，请补充参与情况后再申请。",
      "该条演职员记录已存在，请勿重复申请。",
    ],
    member: [
      "认证信息不足，请补充可核对的身份说明。",
      "请选择与你本人对应的已有队员档案。",
      "档案信息有误，请核对姓名和年级后重新提交。",
    ],
  };
  for (const card of cards) {
    card.id = `review-${kind}-${card.dataset.reviewId}`;
    for (const form of card.querySelectorAll("form")) {
      const note = form.querySelector('[name="admin_note"]');
      if (note) {
        const label = document.createElement("label");
        label.className = "review-reasons";
        label.append("常用理由（仅填入，不提交）");
        const select = document.createElement("select");
        select.add(new Option("选择后仍可修改", ""));
        for (const reason of reasons[kind] || []) select.add(new Option(reason, reason));
        select.addEventListener("change", () => {
          if (!select.value) return;
          const value = note.value.trim();
          note.value = (value ? value + " " : "") + select.value;
          note.value = note.value.slice(0, note.maxLength > 0 ? note.maxLength : 1000);
          note.setCustomValidity("");
          select.value = "";
          note.focus();
        });
        label.append(select);
        form.insertBefore(label, note.closest("label") || note);
        note.addEventListener("input", () => note.setCustomValidity(""));
        // A rejected empty input must not prevent a later approval.
        form.querySelector('[value="approve"]')?.addEventListener("click", () => note.setCustomValidity(""));
      }
      let submitting = false;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitting) return;
        const rejected = event.submitter?.value === "reject" || new URL(form.action).pathname.endsWith("/reject");
        if (rejected && note && !note.value.trim()) {
          event.preventDefault();
          note.setCustomValidity("驳回前请填写理由，可选常用理由后修改。");
          note.reportValidity();
          return;
        }
        const visible = cards.filter((item) => !item.hidden);
        const index = visible.indexOf(card);
        const next = visible[index + 1] || visible[index - 1];
        const body = new FormData(form);
        if (event.submitter?.name) body.set(event.submitter.name, event.submitter.value);
        const buttons = [...card.querySelectorAll("button")];
        const button = event.submitter;
        const original = button?.textContent;
        submitting = true;
        buttons.forEach((b) => (b.disabled = true));
        if (button) button.textContent = "处理中…";
        try {
          const response = await fetch(form.action, {
            method: "POST",
            body,
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(20000),
          });
          const result = response.headers.get("content-type")?.includes("application/json")
            ? await response.json()
            : null;
          if (!response.ok || response.redirected || result?.reviewed !== true)
            throw new Error(result?.error || "未能确认处理结果，请刷新核对。当前说明仍保留。");
          cards = cards.filter((item) => item !== card);
          card.remove();
          document.dispatchEvent(new CustomEvent("blackbox:reviewed"));
          apply();
          feedback.hidden = false;
          feedback.textContent = next
            ? "已处理，已定位下一条，请核对后操作。"
            : "当前筛选下已无待办，可清除筛选查看其他类别。";
          if (next) {
            next.focus({ preventScroll: true });
            next.scrollIntoView({ block: "start" });
          }
        } catch (error) {
          feedback.hidden = false;
          feedback.textContent =
            error.name === "TimeoutError" || error.name === "TypeError"
              ? "网络等待超时或连接中断，结果可能已保存。请刷新核对后再操作，勿重复提交。"
              : error.message;
        } finally {
          submitting = false;
          buttons.forEach((b) => (b.disabled = false));
          if (button) button.textContent = original;
        }
      });
    }
  }
  const progress = read(progressStorage, key);
  write(progressStorage, key, null);
  // On validation failure/back navigation the pending item is still here: never advance.
  if (typeof progress?.submitted === "string" && !cards.some((card) => card.dataset.reviewId === progress.submitted)) {
    const visible = cards.filter((card) => !card.hidden);
    const next =
      (Array.isArray(progress.next) ? progress.next : [])
        .map((id) => visible.find((card) => card.dataset.reviewId === id))
        .find(Boolean) || visible[0];
    feedback.hidden = false;
    feedback.textContent = next
      ? "上一条已不在待办中，已定位下一条，请核对后处理。"
      : "当前筛选下已无待办，可清除筛选查看其他类别。";
    if (next) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "start" });
    } else feedback.scrollIntoView({ block: "center" });
  }
});
