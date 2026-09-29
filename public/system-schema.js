const live = document.querySelector("#system-live");
function schemaExplorer() {
  const graph = live.querySelector("#schema-graph"),
    focus = live.querySelector("#schema-focus"),
    search = live.querySelector("#schema-search");
  if (schemaExplorer.onPopState) window.removeEventListener("popstate", schemaExplorer.onPopState);
  if (!graph || !focus) return;
  const tables = [...live.querySelectorAll("[data-schema-table]")];
  const relations = tables.flatMap((t) =>
    JSON.parse(t.dataset.schemaRelations).map((r) => ({ ...r, owner: t.dataset.schemaTable })),
  );
  const initial = new URL(location.href).searchParams.get("table");
  if (tables.some((t) => t.dataset.schemaTable === initial)) focus.value = initial;
  function draw() {
    const name = focus.value;
    tables.forEach((table) => {
      table.hidden = table.dataset.schemaTable !== name;
      table.open = !table.hidden;
    });
    const connected = relations.filter((r) => r.owner === name || r.table === name);
    const names = [...new Set([name, ...connected.flatMap((r) => [r.owner, r.table])])];
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    const height = Math.max(220, (names.length - 1) * 88 + 40);
    svg.setAttribute("viewBox", `0 0 850 ${height}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", `${name} 与 ${names.length - 1} 张表的已声明外键关系`);
    const el = (tag, attrs, text) => {
      const node = document.createElementNS(ns, tag);
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
      if (text) node.textContent = text;
      svg.append(node);
      return node;
    };
    const centerY = height / 2;
    names.slice(1).forEach((n, i) => {
      const y = 52 + i * 88;
      el("path", {
        d: `M 320 ${centerY} C 425 ${centerY} 425 ${y} 520 ${y}`,
        fill: "none",
        class: "schema-connection",
        "stroke-width": 1.5,
      });
      const edges = connected.filter((r) => r.owner === n || r.table === n);
      if (edges.length > 1) {
        el("rect", { x: 462, y: y - 12, width: 38, height: 24, rx: 12, class: "schema-count-surface" });
        el("text", { x: 481, y: y + 4, "text-anchor": "middle", class: "schema-count" }, "×" + edges.length);
      }
      el("circle", { cx: 520, cy: y, r: 3, class: "schema-port" });
    });
    names.forEach((n, i) => {
      const x = i === 0 ? 40 : 520,
        y = i === 0 ? centerY : 52 + (i - 1) * 88;
      const g = el("g", {
        tabindex: 0,
        role: "button",
        "aria-label": "查看 " + n + " 字段",
        class: "schema-node" + (i === 0 ? " is-current" : ""),
      });
      const rect = document.createElementNS(ns, "rect");
      for (const [k, v] of Object.entries({
        x,
        y: y - 32,
        width: 280,
        height: 64,
        rx: 8,
        fill: i === 0 ? "#6c5430" : "#333027",
        stroke: "#a98e57",
      }))
        rect.setAttribute(k, v);
      g.append(rect);
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", x + 14);
      text.setAttribute("y", y - 4);
      text.textContent = n;
      g.append(text);
      const purpose = tables.find((t) => t.dataset.schemaTable === n)?.dataset.schemaPurpose || "用途未确认";
      const caption = document.createElementNS(ns, "text");
      caption.setAttribute("x", x + 14);
      caption.setAttribute("y", y + 17);
      caption.setAttribute("class", "schema-node-purpose");
      caption.textContent = purpose.length > 20 ? purpose.slice(0, 19) + "…" : purpose;
      g.append(caption);
      const title = document.createElementNS(ns, "title");
      title.textContent = n + " · " + purpose;
      g.append(title);
      const open = () => {
        search.value = "";
        search.dispatchEvent(new Event("input"));
        focus.value = n;
        navigate();
        const target = tables.find((t) => t.dataset.schemaTable === n);
        target?.querySelector("summary").focus();
      };
      g.addEventListener("click", open);
      g.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
    const viewport = document.createElement("div");
    viewport.className = "schema-map-viewport";
    viewport.setAttribute("role", "region");
    viewport.setAttribute("aria-label", "表关系图，可滚动");
    viewport.tabIndex = 0;
    viewport.append(svg);
    graph.replaceChildren(viewport);
    const result = live.querySelector("#schema-result");
    result.textContent = connected.length
      ? `${name}：${connected.length} 条已确认外键。`
      : `${name}：未声明直接外键；业务关联请参阅下方说明。`;
    if (connected.length) {
      const list = document.createElement("ul");
      list.className = "schema-links";
      connected.forEach((r) => {
        const li = document.createElement("li");
        const endpoint = (table, field) => {
          const block = document.createElement("span");
          block.className = "schema-endpoint";
          const name = document.createElement("strong");
          name.textContent = table;
          const column = document.createElement("code");
          column.textContent = field;
          block.append(name, column);
          return block;
        };
        const arrow = document.createElement("span");
        arrow.className = "schema-link-arrow";
        arrow.textContent = "→";
        arrow.setAttribute("aria-label", "引用");
        const behavior = document.createElement("span");
        behavior.className = "schema-delete-rule";
        behavior.textContent = "删除行为 · " + r.on_delete;
        li.append(endpoint(r.owner, r.from), arrow, endpoint(r.table, r.to || "主键"), behavior);
        list.append(li);
      });
      const details = document.createElement("details");
      details.className = "schema-reference-details";
      const summary = document.createElement("summary");
      summary.textContent = "字段引用与删除规则";
      const count = document.createElement("span");
      count.textContent = connected.length + " 项";
      summary.append(count);
      details.append(summary, list);
      graph.append(details);
    }
  }
  function navigate() {
    const url = new URL(location.href);
    url.searchParams.set("table", focus.value);
    history.pushState(null, "", url);
    draw();
  }
  focus.addEventListener("change", navigate);
  const options = tables.map((t) => ({ name: t.dataset.schemaTable, purpose: t.dataset.schemaPurpose }));
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    const matches = options.filter((t) => (t.name + " " + t.purpose).toLowerCase().includes(q));
    const previous = focus.value;
    focus.replaceChildren(
      ...matches.map((t) => {
        const option = document.createElement("option");
        option.value = t.name;
        option.textContent = t.name + " · " + t.purpose;
        return option;
      }),
    );
    focus.disabled = matches.length === 0;
    if (matches.some((t) => t.name === previous)) focus.value = previous;
    if (matches.length) draw();
    else {
      graph.replaceChildren();
      tables.forEach((t) => {
        t.hidden = true;
      });
    }
    live.querySelector("#schema-result").textContent =
      `找到 ${matches.length} / ${tables.length} 张表${matches.length ? "，请选择要查看的表。" : "，没有匹配项，请清空关键词。"}`;
  });
  // The listener belongs to the current snapshot and is replaced on refresh.
  if (schemaExplorer.onPopState) window.removeEventListener("popstate", schemaExplorer.onPopState);
  schemaExplorer.onPopState = () => {
    search.value = "";
    search.dispatchEvent(new Event("input"));
    const name = new URL(location.href).searchParams.get("table") || "resource";
    if (options.some((t) => t.name === name)) focus.value = name;
    draw();
  };
  window.addEventListener("popstate", schemaExplorer.onPopState);
  draw();
}
if (live) {
  new MutationObserver(schemaExplorer).observe(live, { childList: true });
  schemaExplorer();
}
