const form = document.querySelector("#resource-upload");

if (form) {
  const status = document.querySelector("#upload-status");
  const progress = document.querySelector("#upload-progress");
  const cancel = document.querySelector("#upload-cancel");
  const submit = form.querySelector('button[type="submit"]');
  const csrf = form.dataset.csrf;
  let activeTask = "";
  let storageKey = "";

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
  const createTask = async (file) =>
    readJson(
      await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          title: form.elements.title.value,
          resType: form.elements.res_type.value,
          productionId: form.elements.production_id.value || null,
          description: form.elements.description.value,
          originalName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      }),
    );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = form.elements.file.files[0];
    if (!file) {
      show("请选择文件。");
      return;
    }
    submit.disabled = true;
    cancel.hidden = false;
    storageKey = `blackbox-upload:${file.name}:${file.size}:${file.lastModified}`;

    try {
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
        show("正在创建上传任务……");
        task = await createTask(file);
        localStorage.setItem(storageKey, task.id);
      } else {
        show("找到上次中断的任务，正在继续……");
      }

      activeTask = task.id;
      const snapshot = task.parts ? task : await readJson(await fetch(`/api/uploads/${activeTask}`));
      const completedParts = new Set(snapshot.parts.map((part) => part.partNumber));
      let completedBytes = snapshot.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
      progress.max = file.size;
      progress.value = completedBytes;

      const pendingParts = [];
      for (let part = 1; part <= task.totalParts; part += 1) if (!completedParts.has(part)) pendingParts.push(part);
      let nextPart = 0;
      const uploadPart = async () => {
        while (nextPart < pendingParts.length) {
          const part = pendingParts[nextPart];
          nextPart += 1;
          const start = (part - 1) * task.partSize;
          const end = Math.min(file.size, start + task.partSize);
          const blob = file.slice(start, end);
          show(`正在上传第 ${part}/${task.totalParts} 片……`);
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
          progress.value = completedBytes;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, pendingParts.length) }, uploadPart));

      show("正在合并文件……");
      const result = await readJson(
        await fetch(`/api/uploads/${activeTask}/complete`, { method: "POST", headers: { "x-csrf-token": csrf } }),
      );
      localStorage.removeItem(storageKey);
      location.href = `/resources/${result.resourceId}`;
    } catch (error) {
      show(error.message || "上传失败，可以稍后重试。");
      submit.disabled = false;
    }
  });

  cancel.addEventListener("click", async () => {
    if (!activeTask) return;
    try {
      await readJson(
        await fetch(`/api/uploads/${activeTask}`, { method: "DELETE", headers: { "x-csrf-token": csrf } }),
      );
      localStorage.removeItem(storageKey);
      show("上传已取消。");
      activeTask = "";
      cancel.hidden = true;
      submit.disabled = false;
    } catch (error) {
      show(error.message);
    }
  });
}
