import { readUploadResponse, retryUpload } from "./shared/upload-http.js";

const form = document.querySelector("#resource-upload");

if (form) {
  const status = document.querySelector("#upload-status");
  const progress = document.querySelector("#upload-progress");
  const percent = document.querySelector("#upload-percent");
  const cancel = document.querySelector("#upload-cancel");
  const submit = form.querySelector('button[type="submit"]');
  const type = form.elements.res_type;
  const fileInput = form.elements.file;
  const requirePhotoProduction = () => {
    form.elements.production_id.required = type.value === "photo";
  };
  type.addEventListener("change", requirePhotoProduction);
  requirePhotoProduction();
  const csrf = form.dataset.csrf;
  let activeTask = "";
  let canceled = false;
  let uploading = false;
  let wakeLock = null;

  const show = (text) => {
    status.textContent = text;
  };
  const updateProgress = (value, maximum) => {
    progress.max = maximum || 1;
    progress.value = value;
    percent.textContent = `${Math.min(100, Math.round((value / (maximum || 1)) * 100))}%`;
  };
  const keepScreenAwake = async () => {
    try {
      if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    } catch {}
  };
  const releaseScreen = async () => {
    if (!wakeLock) return;
    await wakeLock.release().catch(() => {});
    wakeLock = null;
  };
  addEventListener("beforeunload", (event) => {
    if (!uploading) return;
    event.preventDefault();
    event.returnValue = true;
  });
  document.addEventListener("visibilitychange", () => {
    if (uploading && document.visibilityState === "visible") keepScreenAwake();
  });
  const readJson = readUploadResponse;
  let policyPromise;
  const getPolicy = () =>
    (policyPromise ??= fetch("/api/uploads/policy")
      .then(readJson)
      .catch((error) => {
        policyPromise = undefined;
        throw error;
      }));
  const retry = (action) => retryUpload(action, { delayMs: 800 });
  const baseName = (name) => name.replace(/\.[^.]+$/, "").slice(0, 100) || "未命名剧照";
  const canvasBlob = (source, width, height) =>
    new Promise((resolve, reject) => {
      const scale = Math.min(1, 720 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成预览图。"))), "image/jpeg", 0.64);
    });
  const imageThumbnail = async (file) => {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      try {
        return await canvasBlob(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = async () => {
        try {
          resolve(await canvasBlob(image, image.naturalWidth, image.naturalHeight));
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("无法读取图片。"));
      };
      image.src = url;
    });
  };
  const videoThumbnail = (file) =>
    new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("视频首帧读取超时。")), 15000);
      const finish = async (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          if (error) reject(error);
          else resolve(await canvasBlob(video, video.videoWidth, video.videoHeight));
        } catch (reason) {
          reject(reason);
        } finally {
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(url);
        }
      };
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.addEventListener(
        "loadedmetadata",
        () => {
          video.currentTime = Number.isFinite(video.duration) ? Math.min(1, Math.max(0.1, video.duration * 0.05)) : 0.1;
        },
        { once: true },
      );
      video.addEventListener("seeked", () => finish(), { once: true });
      video.addEventListener("error", () => finish(new Error("无法读取视频首帧。")), { once: true });
      video.src = url;
    });
  const uploadThumbnail = async (task, file) => {
    if (task.hasPreview || (type.value !== "photo" && type.value !== "video")) return;
    show(`正在生成轻量预览：${file.name}`);
    try {
      const blob = type.value === "photo" ? await imageThumbnail(file) : await videoThumbnail(file);
      await retry(async () => {
        const response = await fetch(`/api/uploads/${task.id}/preview`, {
          method: "PUT",
          headers: { "content-type": "image/jpeg", "x-csrf-token": csrf },
          body: blob,
        });
        await readJson(response);
      });
      task.hasPreview = true;
    } catch (error) {
      const failure = new Error(
        "预览图生成或保存失败，请重试；如仍失败，请将图片另存为 JPEG 后上传。已上传的分片会保留。",
      );
      failure.status = error.status;
      failure.retryAfter = error.retryAfter;
      throw failure;
    }
  };
  const videoNotice = "测试阶段不支持视频";
  const isVideoFile = (file) =>
    file.type.toLowerCase().startsWith("video/") ||
    /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|ts|mts|m2ts|ogv)$/i.test(file.name);
  const blockVideo = () => {
    show(videoNotice);
    window.alert(videoNotice);
  };
  fileInput.addEventListener("change", () => {
    if ([...fileInput.files].some(isVideoFile)) {
      fileInput.value = "";
      blockVideo();
    }
  });
  const syncFileMode = () => {
    const photos = type.value === "photo";
    fileInput.multiple = type.value !== "video";
    fileInput.accept = photos ? "image/jpeg,image/png,image/webp,image/avif" : "";
    fileInput.value = "";
    fileInput.disabled = type.value === "video";
    submit.disabled = type.value === "video";
    if (type.value === "video") blockVideo();
    else show("");
  };
  type.addEventListener("change", syncFileMode);
  syncFileMode();

  const fetchComplete = (id) =>
    fetch("/api/uploads/" + id + "/complete", { method: "POST", headers: { "x-csrf-token": csrf } });
  const createTask = async (file, title) =>
    readJson(
      await fetch("/api/uploads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify({
          title,
          resType: type.value,
          productionId: form.elements.production_id.value || null,
          editionId: form.elements.edition_id?.value || null,
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
    const item = batch.items[index - 1];
    let task;
    if (item.taskId) {
      const saved = await readJson(await fetch(`/api/uploads/${item.taskId}`));
      if (saved.originalName !== file.name || saved.sizeBytes !== file.size)
        throw new Error("文件与原上传任务不匹配，请重新选择原文件。");
      if (!["uploading", "completing", "completed"].includes(saved.status))
        throw new Error("原任务已取消或失效，请结束本批后重新添加该文件。");
      task = saved;
    }
    if (!task && !item.taskId) {
      // Adopt an unfinished task from the previous uploader; only its owner can read it.
      const legacyKey = `blackbox-upload:${type.value}:${form.elements.production_id.value}:${form.elements.edition_id?.value || ""}:${file.name}:${file.size}:${file.lastModified}`;
      let legacyId;
      try {
        legacyId = storage?.getItem(legacyKey);
      } catch {}
      if (legacyId) {
        const response = await fetch(`/api/uploads/${encodeURIComponent(legacyId)}`);
        if (response.ok) {
          const saved = await readJson(response);
          if (
            ["uploading", "completing", "completed"].includes(saved.status) &&
            saved.originalName === file.name &&
            saved.sizeBytes === file.size
          ) {
            task = saved;
            item.taskId = saved.id;
            saveBatch();
          }
        } else if (response.status !== 404) await readJson(response);
      }
    }
    if (!task) {
      show(`正在准备第 ${index}/${total} 个文件：${file.name}`);
      task = await createTask(file, title);
      item.taskId = task.id;
      saveBatch();
    } else show(`继续第 ${index}/${total} 个文件：${file.name}`);
    activeTask = task.id;
    if (task.status === "completed" || task.status === "completing") {
      const result = await retry(async () => readJson(await fetchComplete(task.id)));
      item.resourceId = result.resourceId || task.resourceId;
      activeTask = "";
      return;
    }
    await uploadThumbnail(task, file);
    const snapshot = task.parts ? task : await readJson(await fetch(`/api/uploads/${activeTask}`));
    const completedParts = new Set(snapshot.parts.map((part) => part.partNumber));
    let completedBytes = snapshot.parts.reduce((sum, part) => sum + part.sizeBytes, 0);
    updateProgress(bytesBefore + completedBytes, totalBytes);
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
          // Proxy PUT performs the same owner, visibility, CSRF and part validation.
          // Only direct R2 transport needs a separate signed-URL request.
          const target =
            task.mode === "local"
              ? { mode: "local", url: `/api/uploads/${activeTask}/parts/${part}` }
              : await readJson(
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
          if (!uploaded.ok) await readJson(uploaded);
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
        updateProgress(bytesBefore + completedBytes, totalBytes);
      }
    };
    const concurrency = 1;
    await Promise.all(Array.from({ length: Math.min(concurrency, pendingParts.length) }, uploadPart));
    show(`正在保存第 ${index}/${total} 个文件……`);
    const result = await retry(async () => readJson(await fetchComplete(activeTask)));
    item.resourceId = result.resourceId;
    activeTask = "";
  };

  const pause = document.querySelector("#upload-pause");
  const batchPanel = document.querySelector("#upload-batch");
  const batchList = document.querySelector("#upload-batch-list");
  const batchSummary = document.querySelector("#upload-batch-summary");
  const newBatch = document.querySelector("#upload-new-batch");
  const batchKey = `blackbox-upload-batch-v1:${form.dataset.uploadOwner}`;
  const fieldNames = ["title", "res_type", "production_id", "edition_id", "description"];
  let batch = null,
    stopAfterFile = false,
    storage,
    storageAvailable = true;
  const availableFiles = new Map();
  const fileKey = (file) => JSON.stringify([file.name, file.size, file.lastModified]);
  try {
    storage = localStorage;
  } catch {}
  const saveBatch = () => {
    try {
      if (!storage) throw Error();
      if (batch) storage.setItem(batchKey, JSON.stringify(batch));
      else storage.removeItem(batchKey);
    } catch {
      storageAvailable = false;
    }
  };
  const renderBatch = () => {
    batchPanel.hidden = !batch;
    if (!batch) return;
    const done = batch.items.filter((i) => i.state === "done").length;
    const failed = batch.items.filter((i) => i.state === "failed").length;
    const skipped = batch.items.filter((i) => i.state === "skipped").length;
    batchSummary.textContent = `共 ${batch.items.length} 份 · 成功 ${done} · 失败 ${failed} · 跳过 ${skipped} · 待处理 ${batch.items.length - done - failed - skipped}${storageAvailable ? "" : "。浏览器无法保存进度，请保持页面打开。"}`;
    batchList.replaceChildren();
    for (const item of batch.items) {
      const row = document.createElement("li");
      const text = document.createElement("span");
      const labels = {
        done: "已完成",
        failed: "失败",
        pending: "待上传",
        uploading: uploading ? "正在上传" : "待继续",
        skipped: "已跳过",
      };
      text.textContent = `${item.name} · ${labels[item.state]}${item.error ? " · " + item.error : ""}`;
      row.append(text);
      if (item.resourceId && item.state === "done") {
        const link = document.createElement("a");
        link.href = `/resources/${Number(item.resourceId)}`;
        link.textContent = "查看";
        link.target = "_blank";
        link.rel = "noopener";
        row.append(link);
      }
      if (item.state !== "done") {
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "secondary";
        skip.disabled = uploading;
        skip.textContent = item.state === "skipped" ? "恢复到队列" : "跳过此项";
        skip.addEventListener("click", () =>
          withBatchLock(() => {
            item.state = item.state === "skipped" ? "pending" : "skipped";
            saveBatch();
            renderBatch();
          }),
        );
        row.append(skip);
        if (item.taskId && item.state !== "skipped") {
          const abort = document.createElement("button");
          abort.type = "button";
          abort.className = "secondary";
          abort.disabled = uploading;
          abort.textContent = "取消此文件任务";
          abort.addEventListener("click", () =>
            withBatchLock(async () => {
              if (uploading) return;
              uploading = true;
              renderBatch();
              try {
                await readJson(
                  await fetch(`/api/uploads/${item.taskId}`, { method: "DELETE", headers: { "x-csrf-token": csrf } }),
                );
                item.taskId = null;
                item.state = "skipped";
                item.error = "已取消任务";
              } catch (error) {
                item.error = error.message;
              } finally {
                uploading = false;
                saveBatch();
                renderBatch();
              }
            }),
          );
          row.append(abort);
        }
      }
      batchList.append(row);
    }
    submit.textContent = done + skipped === batch.items.length ? "本批处理完毕" : "继续待传与失败项";
    submit.disabled = uploading || done + skipped === batch.items.length;
    newBatch.disabled = uploading;
  };
  const restoreFields = () => {
    if (!batch) return;
    for (const name of fieldNames)
      if (form.elements[name]) {
        form.elements[name].value = batch.fields[name] || "";
        if (name === "res_type" || name === "production_id")
          form.elements[name].dispatchEvent(new Event("change", { bubbles: true }));
      }
    for (const name of fieldNames) if (form.elements[name]) form.elements[name].disabled = true;
    fileInput.required = false;
  };
  try {
    const saved = JSON.parse(storage?.getItem(batchKey) || "null");
    if (saved?.version === 1 && saved.fields && Array.isArray(saved.items) && saved.items.length <= 1000) {
      batch = saved;
      restoreFields();
      renderBatch();
      show("已恢复本批进度，请重新选择原文件以继续；成功项不会重复提交。");
    }
  } catch {}
  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files) availableFiles.set(fileKey(file), file);
    if (batch) show("已重新选择文件，点击继续上传；未选中的待传项会保留。");
  });
  pause.addEventListener("click", () => {
    stopAfterFile = true;
    pause.disabled = true;
    show("当前文件完成后暂停，进度会保留。");
  });
  newBatch.addEventListener("click", () =>
    withBatchLock(() => {
      if (uploading) return;
      if (
        batch.items.some((i) => i.state !== "done" && i.state !== "skipped") &&
        !confirm("本批仍有未完成文件。结束后只能到“我的资料”核对已成功项目，确定结束？")
      )
        return;
      batch = null;
      availableFiles.clear();
      saveBatch();
      batchPanel.hidden = true;
      for (const name of fieldNames) if (form.elements[name]) form.elements[name].disabled = false;
      fileInput.value = "";
      fileInput.required = true;
      submit.disabled = false;
      submit.textContent = "开始上传";
      show("选择下一批文件后开始上传。");
    }),
  );
  const submitBatch = async () => {
    if (uploading) return;
    if (!batch) {
      const files = [...fileInput.files];
      if (type.value === "video" || files.some(isVideoFile)) {
        blockVideo();
        return;
      }
      if (!files.length) return show("请选择文件。");
      if (files.length > 1000) return show("请将本批控制在1000份以内，完成后继续下一批。");
      if (files.length === 1 && !form.elements.title.value.trim()) return show("上传单个文件时请填写资料标题。");
      try {
        const policy = await getPolicy();
        const max = policy.limits[type.value];
        if (!max || files.some((f) => f.size < 1 || f.size > max))
          return show(`此类资料单个文件上限为 ${max / 1024 / 1024}MB。`);
      } catch {
        return show("暂时无法读取上传限制，请稍后重试。");
      }
      batch = {
        version: 1,
        createdAt: Date.now(),
        fields: Object.fromEntries(fieldNames.map((n) => [n, form.elements[n]?.value || ""])),
        items: files.map((f) => ({ key: fileKey(f), name: f.name, size: f.size, state: "pending" })),
      };
      files.forEach((f) => availableFiles.set(fileKey(f), f));
      saveBatch();
      restoreFields();
    }
    const pending = batch.items.filter((i) => i.state !== "done" && i.state !== "skipped");
    if (!pending.some((i) => availableFiles.has(i.key)))
      return show("请重新选择原文件；浏览器刷新后不能自动读取电脑文件。");
    if (batch.retryAt > Date.now())
      return show(`上传额度暂时用尽，请在 ${new Date(batch.retryAt).toLocaleTimeString()} 后继续。本批进度已保留。`);
    canceled = false;
    stopAfterFile = false;
    uploading = true;
    pause.disabled = false;
    pause.hidden = false;
    fileInput.disabled = true;
    renderBatch();
    await keepScreenAwake();
    const totalBytes = batch.items.reduce((sum, i) => sum + i.size, 0);
    let bytesBefore = batch.items.filter((i) => i.state === "done").reduce((sum, i) => sum + i.size, 0);
    try {
      for (let index = 0; index < batch.items.length; index++) {
        const item = batch.items[index];
        const file = availableFiles.get(item.key);
        if (item.state === "done" || item.state === "skipped" || !file) continue;
        item.state = "uploading";
        item.error = "";
        saveBatch();
        renderBatch();
        try {
          await uploadOne(file, index + 1, batch.items.length, bytesBefore, totalBytes);
          item.state = "done";
          bytesBefore += item.size;
        } catch (error) {
          item.state = "failed";
          item.error = error.message || "上传失败，可稍后继续。";
          if (error.status === 429) {
            batch.retryAt = Date.now() + Math.max(1, error.retryAfter || 60) * 1000;
            stopAfterFile = true;
          }
          if ([401, 403, 413].includes(error.status)) stopAfterFile = true;
        }
        saveBatch();
        renderBatch();
        if (stopAfterFile) break;
      }
    } finally {
      uploading = false;
      activeTask = "";
      fileInput.disabled = false;
      pause.hidden = true;
      cancel.hidden = true;
      await releaseScreen();
      saveBatch();
      renderBatch();
      show(
        batch.items.every((i) => i.state === "done" || i.state === "skipped")
          ? "本批处理完成，结果保留在下方；可开始下一批。"
          : "进度已保留，可继续待传与失败项；成功项不会重复提交。",
      );
    }
  };
  const withBatchLock = async (action) => {
    const run = async () => {
      if (uploading) return;
      // A stale tab must reload progress before it is allowed to create tasks.
      if (storageAvailable) {
        try {
          const saved = JSON.parse(storage?.getItem(batchKey) || "null");
          if (JSON.stringify(saved) !== JSON.stringify(batch))
            return show("批次已被另一标签页更新，请刷新后继续，避免重复上传。");
        } catch {}
      }
      return action();
    };
    try {
      if (navigator.locks)
        return await navigator.locks.request(batchKey, { ifAvailable: true }, async (lock) => {
          if (!lock) return show("另一个标签页正在处理本账号的上传，请等待完成后刷新本页。");
          return run();
        });
      return await run();
    } catch {
      show("未能处理上传，请保持页面并稍后重试。");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    withBatchLock(submitBatch);
  });
}
