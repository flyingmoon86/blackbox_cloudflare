// Each selected item still uses its original authorized, CSRF-checked endpoint.
function installReviewQueue(queue) {
  const kind = queue.dataset.reviewQueue;
  const key = `blackbox-review-v2:${queue.dataset.reviewOwner}:${location.pathname}:${kind}`;
  const read = (storage, name) => {
    try {
      return JSON.parse(storage.getItem(name) || "null");
    } catch {
      return null;
    }
  };
  const write = (storage, name, value) => {
    try {
      storage.setItem(name, JSON.stringify(value));
    } catch {}
  };
  let savedStorage, progressStorage;
  try {
    savedStorage = localStorage;
    progressStorage = sessionStorage;
  } catch {}
  let cards = [...queue.querySelectorAll("[data-review-id]")],
    busy = false;
  const query = queue.querySelector("[data-review-query]");
  const filter = queue.querySelector("[data-review-filter]");
  const count = queue.querySelector("[data-review-count]");
  const feedback = queue.querySelector("[data-review-feedback]");
  const stored = read(savedStorage, key);
  for (const category of new Set(cards.map((c) => c.dataset.reviewCategory)))
    filter.add(new Option(category, category));
  query.value = typeof stored?.query === "string" ? stored.query.slice(0, 100) : "";
  if (typeof stored?.category === "string" && stored.category.length <= 80) {
    if (![...filter.options].some((o) => o.value === stored.category))
      filter.add(new Option(stored.category, stored.category));
    filter.value = stored.category;
  }
  if (query.value || filter.value) query.closest("details").open = true;
  const toolbar = document.createElement("form");
  toolbar.className = "review-batch";
  toolbar.innerHTML =
    '<div class="review-batch-selection"><button type="button" class="secondary" data-select-visible>选择当前可见项（最多50条）</button><button type="button" class="secondary" data-clear-selection>取消选择</button><strong data-selected-count aria-live="polite"></strong></div><div data-batch-options hidden><label>统一审核说明<textarea name="batch_note" maxlength="1000" rows="2" placeholder="驳回必填；通过选填"></textarea></label><label class="review-batch-confirm"><input type="checkbox" name="checked_items" required>我已逐项核对所选资料或身份及归属</label><div class="review-batch-actions"><button name="decision" value="approve">通过所选</button><button name="decision" value="reject" class="secondary">驳回所选</button><a href="/admin/review-history">查看审核记录</a></div></div>';
  queue.querySelector(".review-grid").before(toolbar);
  const selected = () =>
    cards.filter((c) => !c.hidden && c.querySelector("[data-review-select]").checked && !c.dataset.reviewUncertain);
  const selectionChanged = () => {
    toolbar.querySelector("[data-selected-count]").textContent = `已选 ${selected().length} 条`;
    toolbar.elements.checked_items.checked = false;
    toolbar.querySelector("[data-batch-options]").hidden = !selected().length;
  };
  const show = (message) => {
    feedback.hidden = false;
    feedback.textContent = message;
  };
  const previous = read(progressStorage, key + ":result");
  if (typeof previous?.summary === "string") show(previous.summary);
  const exportResult = document.createElement("button");
  exportResult.type = "button";
  exportResult.className = "secondary";
  exportResult.textContent = "下载最近一次处理结果";
  exportResult.hidden = !previous?.results?.length;
  feedback.after(exportResult);
  exportResult.addEventListener("click", () => {
    const report = read(progressStorage, key + ":result");
    if (!report?.results?.length) return;
    const rows = [
      ["审核类别", "记录编号", "操作", "结果", "处理时间"],
      ...report.results.map((r) => [
        kind,
        r.id,
        r.decision === "reject" ? "驳回" : "通过",
        { success: "已确认", conflict: "需核对", uncertain: "结果不明", unsent: "未执行" }[r.status] || "需核对",
        new Date(report.at).toISOString(),
      ]),
    ];
    const csv =
      "\ufeff" + rows.map((row) => row.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "review-results.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  const apply = () => {
    const term = query.value.trim().toLocaleLowerCase();
    for (const c of cards) {
      c.hidden = Boolean(
        (filter.value && c.dataset.reviewCategory !== filter.value) ||
        (term && !c.dataset.reviewSearch.toLocaleLowerCase().includes(term)),
      );
      if (c.hidden) c.querySelector("[data-review-select]").checked = false;
    }
    const shown = cards.filter((c) => !c.hidden).length;
    count.textContent =
      `本页显示 ${shown} / ${cards.length} 条待办` +
      (shown === 0 && cards.length ? "，可清除筛选查看本页其他项。" : "");
    write(savedStorage, key, { query: query.value, category: filter.value });
    selectionChanged();
  };
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
  const addReasons = (note) => {
    const label = document.createElement("label");
    label.className = "review-reasons";
    label.append("常用理由（仅填入）");
    const select = document.createElement("select");
    select.add(new Option("选择后仍可修改", ""));
    for (const reason of reasons[kind] || []) select.add(new Option(reason, reason));
    select.addEventListener("change", () => {
      if (select.value) note.value = (note.value.trim() + " " + select.value).trim().slice(0, 1000);
      select.value = "";
    });
    label.append(select);
    note.closest("label")?.after(label);
  };
  addReasons(toolbar.elements.batch_note);
  const refill = async () => {
    if (cards.length || !queue.hasAttribute("data-server-paged")) return;
    const url = new URL(location.href);
    url.searchParams.set("page", "1");
    try {
      const r = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!r.ok || r.redirected) throw Error();
      const doc = new DOMParser().parseFromString(await r.text(), "text/html");
      const next = doc.querySelector(`[data-review-queue="${kind}"]`);
      if (!next || next.dataset.reviewOwner !== queue.dataset.reviewOwner) throw Error();
      const pagination = queue.nextElementSibling;
      if (pagination?.matches(".pagination"))
        pagination.replaceWith(doc.querySelector(".pagination") || document.createTextNode(""));
      queue.replaceWith(next);
      history.replaceState(history.state, "", url);
      installReviewQueue(next);
      next.querySelector("[data-review-id]")?.focus({ preventScroll: true });
    } catch {
      show("本页已处理完；未能读取剩余待办，请刷新核对。刚才的处理结果已保留。");
    }
  };
  const run = async (entries) => {
    if (busy) return;
    busy = true;
    const disabled = [...queue.querySelectorAll("input,textarea,select,button")].map((el) => [el, el.disabled]);
    disabled.forEach(([el]) => (el.disabled = true));
    const results = [];
    try {
      for (const { card, form, body } of entries) {
        const status = card.querySelector("[data-review-row-status]");
        status.textContent = "处理中…";
        let stop = false;
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
          if (response.ok && !response.redirected && result?.reviewed === true) {
            cards = cards.filter((c) => c !== card);
            card.remove();
            results.push({ id: card.dataset.reviewId, status: "success" });
            document.dispatchEvent(new CustomEvent("blackbox:reviewed"));
          } else {
            stop =
              response.redirected ||
              response.status === 401 ||
              response.status === 403 ||
              response.status >= 500 ||
              response.ok;
            status.textContent =
              response.status === 409
                ? "状态已变化，请刷新核对；本项未确认处理。"
                : stop
                  ? "结果未确认，已暂停；请刷新核对后继续。"
                  : "未通过校验，请检查说明并刷新核对。";
            card.dataset.reviewUncertain = "true";
            card.querySelector("[data-review-select]").checked = false;
            results.push({ id: card.dataset.reviewId, status: stop ? "uncertain" : "conflict" });
          }
        } catch {
          stop = true;
          card.dataset.reviewUncertain = "true";
          card.querySelector("[data-review-select]").checked = false;
          status.textContent = "连接中断或等待超时，结果可能已保存。请刷新核对，勿重复提交。";
          results.push({ id: card.dataset.reviewId, status: "uncertain" });
        }
        const done = results.filter((r) => r.status === "success").length;
        const summary = `本次已确认 ${done} 条，需核对 ${results.length - done} 条，未执行 ${entries.length - results.length} 条。`;
        const report = entries.map((entry, i) => ({
          id: entry.card.dataset.reviewId,
          decision:
            entry.body.get("decision") ||
            (new URL(entry.form.action).pathname.endsWith("/reject") ? "reject" : "approve"),
          status: results[i]?.status || "unsent",
        }));
        write(progressStorage, key + ":result", { summary, results: report, at: Date.now() });
        show(summary);
        exportResult.hidden = false;
        if (stop) break;
      }
    } finally {
      busy = false;
      disabled.forEach(([el, was]) => {
        el.disabled = was;
      });
      cards
        .filter((c) => c.dataset.reviewUncertain)
        .forEach((c) => c.querySelectorAll("button,[data-review-select]").forEach((el) => (el.disabled = true)));
      apply();
      await refill();
    }
  };
  for (const card of cards) {
    card.id = `review-${kind}-${card.dataset.reviewId}`;
    const label = document.createElement("label");
    label.className = "review-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.reviewSelect = "";
    checkbox.addEventListener("change", () => {
      if (selected().length > 50) checkbox.checked = false;
      selectionChanged();
    });
    label.append(checkbox, "选择此项");
    card.prepend(label);
    const status = document.createElement("p");
    status.dataset.reviewRowStatus = "";
    status.setAttribute("role", "status");
    card.append(status);
    for (const form of card.querySelectorAll("form")) {
      const note = form.querySelector('[name="admin_note"]');
      if (note) addReasons(note);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (busy || card.dataset.reviewUncertain) return;
        const rejected = event.submitter?.value === "reject" || new URL(form.action).pathname.endsWith("/reject");
        if (rejected && note && !note.value.trim()) {
          show("驳回前请填写理由。");
          note.focus();
          return;
        }
        const body = new FormData(form);
        if (event.submitter?.name) body.set(event.submitter.name, event.submitter.value);
        const next = cards.filter((c) => !c.hidden && c !== card)[0];
        await run([{ card, form, body }]);
        if (next?.isConnected) {
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: "nearest" });
        }
      });
    }
  }
  toolbar.querySelector("[data-select-visible]").addEventListener("click", () => {
    cards
      .filter((c) => !c.hidden && !c.dataset.reviewUncertain)
      .slice(0, 50)
      .forEach((c) => (c.querySelector("[data-review-select]").checked = true));
    selectionChanged();
  });
  toolbar.querySelector("[data-clear-selection]").addEventListener("click", () => {
    cards.forEach((c) => (c.querySelector("[data-review-select]").checked = false));
    selectionChanged();
  });
  toolbar.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const choice = event.submitter?.value;
    const items = selected();
    const note = toolbar.elements.batch_note.value.trim();
    if (!["approve", "reject"].includes(choice) || !items.length) {
      show("请先选择要处理的项目。");
      return;
    }
    if (choice === "reject" && !note) {
      show("请填写统一驳回理由。");
      toolbar.elements.batch_note.focus();
      return;
    }
    const entries = items.map((card) => {
      const form = kind === "member" ? card.querySelector(`form[action$="/${choice}"]`) : card.querySelector("form");
      const body = new FormData(form);
      body.set("admin_note", note);
      body.set("decision", choice);
      return { card, form, body };
    });
    await run(entries);
  });
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
  toolbar.hidden = !cards.length;
}

document.querySelectorAll("[data-review-queue]").forEach(installReviewQueue);
