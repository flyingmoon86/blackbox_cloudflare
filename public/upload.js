const form = document.querySelector("#resource-upload");

if (form) {
  const status = document.querySelector("#upload-status");
  const progress = document.querySelector("#upload-progress");
  const cancel = document.querySelector("#upload-cancel");
  const submit = form.querySelector('button[type="submit"]');
  const type = form.elements.res_type;
  const fileInput = form.elements.file;
  const csrf = form.dataset.csrf;
  let activeTask = "";
  let storageKey = "";
  let canceled = false;

  const show = (text) => {
    status.textContent = text;
  };
  const readJson = async (response) => {
    const body = await response.json().catch(() => ({ error: "服务器返回异常。" }));
    if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
    return body;
  };
  const retry = async (action) => {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
      }
    }
    throw lastError;
  };
  const baseName = (name) => name.replace(/\.[^.]+$/, "").slice(0, 100) || "未命名剧照";
  const syncFileMode = () => {
    const photos = type.value === "photo";
    fileInput.multiple = photos;
    fileInput.accept = photos ? "image/jpeg,image/png,image/webp,image/avif" : "";
    fileInput.value = "";
  };
  type.addEventListener("change", syncFileMode);
  syncFileMode();

  const createTask = async (file, title) =>
    readJson(
      await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          title,
          resType: type.value,
          productionId: form.elements.production_id.value || null,
          description: form.elements.description.value,
          originalName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      }),
    );

  const uploadOne = async (file, index, total, bytesBefore, totalBytes) => {
    const enteredTitle = form.elements.title.value.trim();
    const title = total > 1 ? baseName(file.name) : enteredTitle || baseName(file.name);
    storageKey = `blackbox-upload:${type.value}:${form.elements.production_id.value}:${file.name}:${file.size}:${file.lastModified}`;
    let task;
    const savedId = localStorage.getItem(storageKey);
    if (savedId) {
      const response = await fetch(`/api/uploads/${savedId}`);
      if (response.ok) {
        const saved = await response.json();
        if (saved.status === "uploading" && saved.originalName === file.name && saved.sizeBytes === file.size)
          task = saved;
      }
    }
    if (!task) {
      show(`正在准备第 ${index}/${total} 个文件：${file.name}`);
      task = await createTask(file, title);
      localStorage.setItem(storageKey, task.id);
    } else show(`继续第 ${index}/${total} 个文件：${file.name}`);

    activeTask = task.id;
    const snapshot = task.parts ? task : await readJson(await fetch(`/api/uploads/${activeTask}`));
    const completedParts = new Set(snapshot.parts.map((part) => part.partNumber));
    let completedBytes = snapshot.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    progress.max = totalBytes;
    progress.value = bytesBefore + completedBytes;
    const pendingParts = [];
    for (let part = 1; part <= task.totalParts; part += 1) if (!completedParts.has(part)) pendingParts.push(part);
    let nextPart = 0;
    const uploadPart = async () => {
      while (nextPart < pendingParts.length) {
        if (canceled) throw new Error("上传已取消。");
        const part = pendingParts[nextPart++];
        const start = (part - 1) * task.partSize;
        const end = Math.min(file.size, start + task.partSize);
        const blob = file.slice(start, end);
        show(`第 ${index}/${total} 个文件，正在上传第 ${part}/${task.totalParts} 片……`);
        await retry(async () => {
          const target = await readJson(
            await fetch(`/api/uploads/${activeTask}/parts/${part}/url`, {
              method: "POST",
              headers: { "x-csrf-token": csrf },
            }),
          );
          const uploaded = await fetch(target.url, {
            method: "PUT",
            headers: target.mode === "local" ? { "x-csrf-token": csrf } : {},
            body: blob,
          });
          if (!uploaded.ok) throw new Error(`第 ${part} 片上传失败（${uploaded.status}）`);
          if (target.mode === "direct") {
            const etag = uploaded.headers.get("etag");
            if (!etag) throw new Error("R2 未返回 ETag，请检查 Bucket CORS。");
            await readJson(
              await fetch(`/api/uploads/${activeTask}/parts/${part}/complete`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-csrf-token": csrf },
                body: JSON.stringify({ etag, sizeBytes: blob.size }),
              }),
            );
          }
        });
        completedBytes += blob.size;
        progress.value = bytesBefore + completedBytes;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, pendingParts.length) }, uploadPart));
    show(`正在保存第 ${index}/${total} 个文件……`);
    await readJson(
      await fetch(`/api/uploads/${activeTask}/complete`, {
        method: "POST",
        headers: { "x-csrf-token": csrf },
      }),
    );
    localStorage.removeItem(storageKey);
    activeTask = "";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = [...fileInput.files];
    if (!files.length) return show("请选择文件。");
    if (files.length > 1 && type.value !== "photo") return show("只有剧照支持一次选择多个文件。");
    if (files.length === 1 && !form.elements.title.value.trim()) return show("上传单个文件时请填写资料标题。");
    canceled = false;
    submit.disabled = true;
    cancel.hidden = false;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let bytesBefore = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        await uploadOne(files[index], index + 1, files.length, bytesBefore, totalBytes);
        bytesBefore += files[index].size;
      }
      show(`${files.length} 个文件已提交，等待管理员分别审核。`);
      location.href = "/my-resources";
    } catch (error) {
      show(error.message || "上传失败，可以稍后重试。");
      submit.disabled = false;
      cancel.hidden = !activeTask;
    }
  });

  cancel.addEventListener("click", async () => {
    canceled = true;
    if (!activeTask) return;
    try {
      await readJson(
        await fetch(`/api/uploads/${activeTask}`, {
          method: "DELETE",
          headers: { "x-csrf-token": csrf },
        }),
      );
      localStorage.removeItem(storageKey);
      show("当前文件上传已取消。已完成的其他剧照仍会保留并等待审核。");
      activeTask = "";
      cancel.hidden = true;
      submit.disabled = false;
    } catch (error) {
      show(error.message);
    }
  });
}
