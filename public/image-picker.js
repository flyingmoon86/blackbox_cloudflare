/* Native selects remain usable without JavaScript. Only an explicit confirmation changes their value. */
(() => {
  const fields = {
    hero_photo: "首页背景",
    productions_background: "作品与资料背景",
    members_background: "队员与剧团背景",
    thanks_background: "鸣谢背景",
    mascot_photo: "本周明星照片",
    cover_id: "作品封面",
    recruitment_poster: "通用海报",
    recruitment_poster_mobile: "手机海报",
  };
  const urlFor = (value) => (/^[1-9]\d*$/.test(String(value)) ? `/resources/${value}/preview` : "");
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    if (tag === "button") element.type = "button";
    return element;
  };
  for (const [name, label] of Object.entries(fields)) {
    const select = document.querySelector(`select[name="${name}"]`);
    if (!(select instanceof HTMLSelectElement)) continue;
    const host = node("div", undefined, "image-select-preview");
    const preview = node("img");
    preview.alt = label + "当前选择";
    preview.decoding = "async";
    const status = node("span", undefined, "hint");
    status.setAttribute("role", "status");
    const open = node("button", "备选图片", "secondary");
    select.hidden = true;
    host.append(preview, status, open);
    select.closest("label").insertAdjacentElement("afterend", host);
    const update = () => {
      let url = urlFor(select.value),
        title = select.selectedOptions[0]?.textContent || "未选择图片";
      if (!url && name === "mascot_photo") url = "/images/elephant-mascot-360-v1.webp";
      if (!url && name === "recruitment_poster_mobile") {
        url = urlFor(document.querySelector('[name="recruitment_poster"]')?.value || "");
        if (url) title = "沿用通用海报";
      }
      preview.hidden = !url;
      status.textContent = title;
      if (url) preview.src = url;
      else preview.removeAttribute("src");
    };
    preview.addEventListener("error", () => {
      preview.hidden = true;
      status.textContent = (select.selectedOptions[0]?.textContent || "当前图片") + " · 预览暂不可用，选择仍保留。";
    });
    select.addEventListener("change", update);
    if (name === "recruitment_poster_mobile")
      document.querySelector('[name="recruitment_poster"]')?.addEventListener("change", update);
    update();
    open.addEventListener("click", () => {
      let draft = { id: select.value, title: select.selectedOptions[0]?.textContent || "未选择图片" };
      let groups = [],
        group = "",
        query = "",
        page = 1,
        pages = 1,
        mode = "groups",
        requestId = 0,
        controller,
        timer;
      let retryAction = () => loadGroups();
      const dialog = node("dialog", undefined, "image-picker");
      dialog.setAttribute("aria-label", "选择" + label);
      dialog.innerHTML = `<header class="picker-header"><div><p class="eyebrow">图片资料库</p><h2></h2></div><button type="button" class="secondary" data-close>取消 ×</button></header>
        <section class="picker-selection" aria-label="待使用的图片"><img alt="当前待选图片"><div><small>当前待选 · 切换分类会保留</small><strong></strong></div><button type="button" class="secondary" data-default></button></section>
        <div class="picker-tools"><label>按作品浏览<select aria-label="图片分类"><option value="">先选分类，或直接搜索图片</option></select></label><form role="search"><label>搜索图片<input type="search" maxlength="80" placeholder="图片、作品或版本名称" aria-label="搜索图片"></label><button type="submit">搜索</button></form></div>
        <div class="picker-categories-filter"><label>查找作品分类<input type="search" placeholder="输入作品名称" aria-label="查找作品分类"></label></div>
        <p class="picker-status" role="status" aria-live="polite"></p><div class="picker-results" aria-label="备选图片与分类"></div>
        <nav class="picker-pagination" aria-label="图片选择分页"><button type="button" class="secondary" data-prev>上一页</button><span></span><button type="button" class="secondary" data-next>下一页</button></nav>
        <footer class="picker-footer"><span>确认后还需保存所在页面。</span><button type="button" data-confirm>使用这张图片</button></footer>`;
      const $ = (s) => dialog.querySelector(s);
      $("h2").textContent = "选择" + label;
      const results = $(".picker-results"),
        feedback = $(".picker-status"),
        categoriesFilter = $(".picker-categories-filter"),
        category = $(".picker-tools select"),
        search = $('[aria-label="搜索图片"]'),
        groupSearch = $('[aria-label="查找作品分类"]');
      const selectionImg = $(".picker-selection img");
      const emptyTitle = select.querySelector('option[value=""]')?.textContent || "不设置";
      $("[data-default]").textContent = "恢复默认：" + emptyTitle;
      const updateDraft = () => {
        $(".picker-selection strong").textContent = draft.title;
        const url = urlFor(draft.id);
        selectionImg.hidden = !url;
        if (url) selectionImg.src = url;
        else selectionImg.removeAttribute("src");
        $("[data-confirm]").textContent = draft.id ? "使用这张图片" : "使用默认设置";
        results.querySelectorAll("[data-image-id]").forEach((button) => {
          const chosen = button.dataset.imageId === String(draft.id);
          button.setAttribute("aria-pressed", String(chosen));
          button.querySelector(".picker-chosen").textContent = chosen ? "✓ 已选" : "选择";
        });
      };
      selectionImg.addEventListener("error", () => {
        selectionImg.hidden = true;
        $(".picker-selection strong").textContent = draft.title + "（预览暂不可用，选择已保留）";
      });
      $("[data-default]").onclick = () => {
        draft = { id: "", title: emptyTitle };
        updateDraft();
      };
      $("[data-confirm]").onclick = () => {
        let option = [...select.options].find((option) => option.value === String(draft.id));
        if (!option) {
          option = new Option(draft.title, String(draft.id));
          select.add(option);
        }
        select.value = String(draft.id);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        dialog.close();
      };
      $("[data-close]").onclick = () => dialog.close();
      const pagination = () => {
        $("[data-prev]").disabled = page <= 1;
        $("[data-next]").disabled = page >= pages;
        $(".picker-pagination span").textContent = `${page} / ${pages}`;
        $(".picker-pagination").hidden = pages <= 1;
      };
      const cancelRequest = () => {
        controller?.abort();
        requestId++;
        results.setAttribute("aria-busy", "false");
      };
      const begin = () => {
        cancelRequest();
        controller = new AbortController();
        feedback.textContent = "正在加载…";
        results.replaceChildren();
        results.setAttribute("aria-busy", "true");
        $(".picker-pagination").hidden = true;
        const loading = node("div", undefined, "picker-loading");
        loading.setAttribute("aria-hidden", "true");
        for (let i = 0; i < 6; i++) loading.append(node("span"));
        results.append(loading);
        return { id: requestId, signal: controller.signal };
      };
      const request = async (params, signal) => {
        params.set("field", name);
        if (select.dataset.imageProduction) params.set("production", select.dataset.imageProduction);
        const activeController = controller;
        const timeout = setTimeout(() => activeController.abort(), 12000);
        try {
          const response = await fetch("/admin/image-options?" + params, {
            credentials: "same-origin",
            signal,
            headers: { Accept: "application/json" },
          });
          if (!response.ok) throw new Error("load failed");
          return await response.json();
        } finally {
          clearTimeout(timeout);
        }
      };
      const failure = (id) => {
        if (id !== requestId || !dialog.open) return;
        results.setAttribute("aria-busy", "false");
        results.replaceChildren();
        feedback.textContent = "图片列表加载失败。已选图片仍保留，请重试；登录过期时请重新登录。";
        const retry = node("button", "重新加载", "secondary");
        retry.onclick = () => retryAction();
        results.append(retry);
      };
      function showGroups() {
        cancelRequest();
        mode = "groups";
        categoriesFilter.hidden = false;
        results.className = "picker-results picker-groups";
        results.replaceChildren();
        const term = groupSearch.value.trim().toLocaleLowerCase();
        const matches = groups.filter((item) => item.title.toLocaleLowerCase().includes(term));
        pages = Math.max(1, Math.ceil(matches.length / 12));
        page = Math.min(page, pages);
        feedback.textContent = matches.length
          ? "先选作品分类，再加载图片；也可以直接搜索图片名称。"
          : groups.length
            ? "没有符合条件的分类。试试其他作品名称。"
            : "当前用途暂无已审核的可选图片。";
        for (const item of matches.slice((page - 1) * 12, page * 12)) {
          const button = node("button", undefined, "secondary picker-group");
          button.append(node("strong", item.title), node("span", `${item.count} 张图片`));
          button.onclick = () => {
            category.value = item.key;
            group = item.key;
            page = 1;
            loadImages();
          };
          results.append(button);
        }
        pagination();
      }
      async function loadGroups() {
        retryAction = loadGroups;
        const { id, signal } = begin();
        try {
          const data = await request(new URLSearchParams({ mode: "groups" }), signal);
          if (id !== requestId || !dialog.open) return;
          groups = data.groups;
          if (!groups.some((item) => item.key === "unlinked") && name !== "cover_id")
            groups.unshift({ key: "unlinked", title: "未关联作品", count: 0 });
          category.replaceChildren(new Option("所有分类入口 / 跨作品搜索", ""));
          for (const item of groups) category.add(new Option(`${item.title}（${item.count}）`, item.key));
          showGroups();
        } catch {
          failure(id);
        }
      }
      function showPreview(item, opener) {
        const viewer = node("dialog", undefined, "picker-lightbox");
        viewer.setAttribute("aria-label", "图片放大预览");
        const close = node("button", "关闭预览", "secondary"),
          image = node("img"),
          caption = node("p", item.title),
          error = node("p", "图片预览加载失败。请关闭后重试。");
        image.alt = item.title;
        image.src = urlFor(item.id);
        error.hidden = true;
        image.onerror = () => {
          image.hidden = true;
          error.hidden = false;
        };
        close.onclick = () => viewer.close();
        viewer.append(close, image, caption, error);
        document.body.append(viewer);
        viewer.addEventListener(
          "close",
          () => {
            viewer.remove();
            opener.focus();
          },
          { once: true },
        );
        viewer.showModal();
        dialog.addEventListener(
          "close",
          () => {
            if (viewer.open) viewer.close();
          },
          { once: true },
        );
      }
      async function loadImages() {
        query = search.value.trim();
        group = category.value;
        if (!group && !query) {
          page = 1;
          showGroups();
          return;
        }
        mode = "images";
        categoriesFilter.hidden = true;
        retryAction = loadImages;
        const { id, signal } = begin();
        results.className = "picker-results picker-images";
        try {
          const data = await request(
            new URLSearchParams({ mode: "images", group, q: query, page: String(page) }),
            signal,
          );
          if (id !== requestId || !dialog.open) return;
          results.replaceChildren();
          results.setAttribute("aria-busy", "false");
          page = data.page;
          pages = data.pages;
          const categoryTitle = groups.find((item) => item.key === group)?.title || "跨作品搜索";
          feedback.textContent = data.total
            ? `${categoryTitle} · 找到 ${data.total} 张，每页最多 ${data.size} 张`
            : `${categoryTitle} · ${query ? "没有匹配的图片，试试其他关键词或分类。" : "暂无可选图片。这里只显示符合当前用途的已审核图片。"}`;
          for (const item of data.items) {
            const card = node("article", undefined, "picker-image");
            const choose = node("button", undefined, "secondary picker-choose");
            choose.dataset.imageId = String(item.id);
            choose.setAttribute("aria-label", "选择图片：" + item.title);
            const image = node("img");
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.src = urlFor(item.id);
            const error = node("span", "预览暂不可用", "picker-image-error");
            error.hidden = true;
            image.onerror = () => {
              image.hidden = true;
              error.hidden = false;
            };
            choose.append(
              image,
              error,
              node("span", item.title, "picker-image-title"),
              node(
                "small",
                item.issue ||
                  item.edition_name ||
                  (item.group_key === "unlinked" ? "未关联作品" : item.production_title || "作品信息待补充"),
              ),
              node("span", "选择", "picker-chosen"),
            );
            choose.onclick = () => {
              draft = { id: String(item.id), title: item.title };
              updateDraft();
            };
            const enlarge = node("button", "放大预览", "secondary picker-enlarge");
            enlarge.onclick = () => showPreview(item, enlarge);
            card.append(choose, enlarge);
            results.append(card);
          }
          updateDraft();
          pagination();
          results.scrollTop = 0;
        } catch {
          failure(id);
        }
      }
      category.onchange = () => {
        clearTimeout(timer);
        page = 1;
        loadImages();
      };
      $(".picker-tools form").onsubmit = (event) => {
        event.preventDefault();
        clearTimeout(timer);
        page = 1;
        loadImages();
      };
      search.oninput = () => {
        clearTimeout(timer);
        cancelRequest();
        timer = setTimeout(() => {
          page = 1;
          loadImages();
        }, 300);
      };
      groupSearch.oninput = () => {
        page = 1;
        showGroups();
      };
      $("[data-prev]").onclick = () => {
        page--;
        mode === "groups" ? showGroups() : loadImages();
      };
      $("[data-next]").onclick = () => {
        page++;
        mode === "groups" ? showGroups() : loadImages();
      };
      document.body.append(dialog);
      updateDraft();
      dialog.showModal();
      loadGroups();
      dialog.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          cancelRequest();
          dialog.remove();
          open.focus();
        },
        { once: true },
      );
    });
  }
})();
