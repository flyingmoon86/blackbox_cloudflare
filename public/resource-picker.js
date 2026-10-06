(() => {
  document.querySelectorAll("[data-resource-picker]").forEach((picker) => {
    const cards = [...picker.querySelectorAll("[data-resource-card]")].map((element) => ({
      element,
      input: element.querySelector('input[name="resource_ids"]'),
      search: element.dataset.search.toLocaleLowerCase(),
    }));
    if (!cards.length) return;
    const find = (name) => picker.querySelector(`[data-picker-${name}]`);
    const search = find("search"),
      type = find("type"),
      status = find("status"),
      selected = find("selected");
    const cover = picker.closest("form").querySelector('[name="cover_id"]');
    const size = 12;
    let page = 1,
      selectedOnly = false,
      visible = [];

    function render() {
      const query = search.value.trim().toLocaleLowerCase();
      const filtered = cards.filter(
        ({ element, input, search: text }) =>
          (!query || text.includes(query)) &&
          (!type.value || element.dataset.type === type.value) &&
          (!status.value || element.dataset.status === status.value) &&
          (!selectedOnly || input.checked),
      );
      const pages = Math.max(1, Math.ceil(filtered.length / size));
      page = Math.min(page, pages);
      visible = filtered.slice((page - 1) * size, page * size);
      const shown = new Set(visible);
      for (const card of cards) {
        // Keep every checkbox in the form: filtering must never detach existing associations on save.
        card.element.hidden = !shown.has(card);
        card.element.querySelector("[data-choice-label]").textContent = card.input.checked ? "已选择" : "选择资料";
        card.element.querySelector("[data-cover-badge]").hidden = card.input.value !== cover?.value;
        const img = card.element.querySelector("img[data-src]");
        if (!card.element.hidden && img) {
          img.addEventListener(
            "error",
            () => {
              img.hidden = true;
            },
            { once: true },
          );
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
      }
      find("count").textContent =
        `已选 ${cards.filter(({ input }) => input.checked).length} 项 · 筛选结果 ${filtered.length} / ${cards.length} 项`;
      find("empty").hidden = filtered.length > 0;
      find("page").textContent = `第 ${page} / ${pages} 页`;
      find("prev").disabled = page === 1;
      find("next").disabled = page === pages;
      find("select-page").disabled = !visible.some(({ input }) => !input.checked);
      find("clear-page").disabled = !visible.some(({ input }) => input.checked);
      find("cover-warning").hidden =
        !cover?.value || cards.some(({ input }) => input.value === cover.value && input.checked);
      selected.setAttribute("aria-pressed", String(selectedOnly));
    }
    function filter() {
      page = 1;
      render();
    }
    search.addEventListener("input", filter);
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
    type.addEventListener("change", filter);
    status.addEventListener("change", filter);
    selected.addEventListener("click", () => {
      selectedOnly = !selectedOnly;
      filter();
    });
    find("reset").addEventListener("click", () => {
      search.value = type.value = status.value = "";
      selectedOnly = false;
      filter();
    });
    cards.forEach(({ input }) =>
      input.addEventListener("change", () => {
        render();
        // A deselected card disappears in selected-only mode; leave focus at a visible control.
        if (selectedOnly && !input.checked) selected.focus({ preventScroll: true });
      }),
    );
    for (const [action, checked] of [
      ["select-page", true],
      ["clear-page", false],
    ]) {
      find(action).addEventListener("click", () => {
        visible.forEach(({ input }) => {
          input.checked = checked;
        });
        render();
      });
    }
    for (const [action, delta] of [
      ["prev", -1],
      ["next", 1],
    ]) {
      find(action).addEventListener("click", () => {
        page += delta;
        render();
        find("search").focus({ preventScroll: true });
        find("tools").scrollIntoView({ block: "start", behavior: "instant" });
      });
    }
    cover?.addEventListener("change", render);
    picker.closest("form").addEventListener("reset", () => setTimeout(filter, 0));
    find("tools").hidden = find("pagination").hidden = false;
    render();
  });
})();
