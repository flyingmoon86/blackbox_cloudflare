// Generated from src/client/upload.js by npm run assets:build. Do not edit this output.
"use strict";
(() => {
  // src/client/shared/upload-http.js
  async function readUploadResponse(response, {
    optionalNotFound = false,
    authMessage,
    failureMessage = (status) => `\u8BF7\u6C42\u5931\u8D25\uFF08${status}\uFF09`,
    invalidMessage = "\u670D\u52A1\u5668\u8FD4\u56DE\u5F02\u5E38\u3002"
  } = {}) {
    if (optionalNotFound && response.status === 404 && !response.redirected) return null;
    const body = await response.json().catch(() => null);
    const invalid = !body || typeof body !== "object" || Array.isArray(body);
    if (!response.ok || response.redirected || invalid) {
      const auth = response.redirected || response.status === 401 || response.status === 403;
      const message = auth && authMessage ? authMessage : typeof body?.error === "string" && body.error ? body.error : invalid ? invalidMessage : failureMessage(response.status);
      const error = new Error(message);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get("Retry-After")) || 0;
      error.retryable = !response.redirected && response.status >= 500;
      throw error;
    }
    return body;
  }
  async function retryUpload(action, { delayMs = 800, attempts = 3, sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await action();
      } catch (error) {
        if (error.name === "AbortError" || error.retryable === false || error.status > 0 && error.status < 500 || attempt === attempts - 1)
          throw error;
        await sleep(delayMs * 2 ** attempt);
      }
    }
    throw new Error("Upload retry requires at least one attempt");
  }

  // src/client/upload.js
  var form = document.querySelector("#resource-upload");
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
      percent.textContent = `${Math.min(100, Math.round(value / (maximum || 1) * 100))}%`;
    };
    const keepScreenAwake = async () => {
      try {
        if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen");
      } catch {
      }
    };
    const releaseScreen = async () => {
      if (!wakeLock) return;
      await wakeLock.release().catch(() => {
      });
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
    const getPolicy = () => policyPromise ??= fetch("/api/uploads/policy").then(readJson).catch((error) => {
      policyPromise = void 0;
      throw error;
    });
    const retry = (action) => retryUpload(action, { delayMs: 800 });
    const baseName = (name) => name.replace(/\.[^.]+$/, "").slice(0, 100) || "\u672A\u547D\u540D\u5267\u7167";
    const canvasBlob = (source, width, height) => new Promise((resolve, reject) => {
      const scale = Math.min(1, 720 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("\u65E0\u6CD5\u751F\u6210\u9884\u89C8\u56FE\u3002")), "image/jpeg", 0.64);
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
          reject(new Error("\u65E0\u6CD5\u8BFB\u53D6\u56FE\u7247\u3002"));
        };
        image.src = url;
      });
    };
    const videoThumbnail = (file) => new Promise((resolve, reject) => {
      const video = document.createElement("video");
      const url = URL.createObjectURL(file);
      let settled = false;
      const timeout = setTimeout(() => finish(new Error("\u89C6\u9891\u9996\u5E27\u8BFB\u53D6\u8D85\u65F6\u3002")), 15e3);
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
        { once: true }
      );
      video.addEventListener("seeked", () => finish(), { once: true });
      video.addEventListener("error", () => finish(new Error("\u65E0\u6CD5\u8BFB\u53D6\u89C6\u9891\u9996\u5E27\u3002")), { once: true });
      video.src = url;
    });
    const uploadThumbnail = async (task, file) => {
      if (task.hasPreview || type.value !== "photo" && type.value !== "video") return;
      show(`\u6B63\u5728\u751F\u6210\u8F7B\u91CF\u9884\u89C8\uFF1A${file.name}`);
      try {
        const blob = type.value === "photo" ? await imageThumbnail(file) : await videoThumbnail(file);
        await retry(async () => {
          const response = await fetch(`/api/uploads/${task.id}/preview`, {
            method: "PUT",
            headers: { "content-type": "image/jpeg", "x-csrf-token": csrf },
            body: blob
          });
          await readJson(response);
        });
        task.hasPreview = true;
      } catch (error) {
        const failure = new Error(
          "\u9884\u89C8\u56FE\u751F\u6210\u6216\u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\uFF1B\u5982\u4ECD\u5931\u8D25\uFF0C\u8BF7\u5C06\u56FE\u7247\u53E6\u5B58\u4E3A JPEG \u540E\u4E0A\u4F20\u3002\u5DF2\u4E0A\u4F20\u7684\u5206\u7247\u4F1A\u4FDD\u7559\u3002"
        );
        failure.status = error.status;
        failure.retryAfter = error.retryAfter;
        throw failure;
      }
    };
    const videoNotice = "\u6D4B\u8BD5\u9636\u6BB5\u4E0D\u652F\u6301\u89C6\u9891";
    const isVideoFile = (file) => file.type.toLowerCase().startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|mpeg|mpg|3gp|ts|mts|m2ts|ogv)$/i.test(file.name);
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
    const fetchComplete = (id) => fetch("/api/uploads/" + id + "/complete", { method: "POST", headers: { "x-csrf-token": csrf } });
    const createTask = async (file, title) => readJson(
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
          sizeBytes: file.size
        })
      })
    );
    const uploadOne = async (file, index, total, bytesBefore, totalBytes) => {
      const enteredTitle = form.elements.title.value.trim();
      const title = total > 1 ? baseName(file.name) : enteredTitle || baseName(file.name);
      const item = batch.items[index - 1];
      let task;
      if (item.taskId) {
        const saved = await readJson(await fetch(`/api/uploads/${item.taskId}`));
        if (saved.originalName !== file.name || saved.sizeBytes !== file.size)
          throw new Error("\u6587\u4EF6\u4E0E\u539F\u4E0A\u4F20\u4EFB\u52A1\u4E0D\u5339\u914D\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u539F\u6587\u4EF6\u3002");
        if (!["uploading", "completing", "completed"].includes(saved.status))
          throw new Error("\u539F\u4EFB\u52A1\u5DF2\u53D6\u6D88\u6216\u5931\u6548\uFF0C\u8BF7\u7ED3\u675F\u672C\u6279\u540E\u91CD\u65B0\u6DFB\u52A0\u8BE5\u6587\u4EF6\u3002");
        task = saved;
      }
      if (!task && !item.taskId) {
        const legacyKey = `blackbox-upload:${type.value}:${form.elements.production_id.value}:${form.elements.edition_id?.value || ""}:${file.name}:${file.size}:${file.lastModified}`;
        let legacyId;
        try {
          legacyId = storage?.getItem(legacyKey);
        } catch {
        }
        if (legacyId) {
          const response = await fetch(`/api/uploads/${encodeURIComponent(legacyId)}`);
          if (response.ok) {
            const saved = await readJson(response);
            if (["uploading", "completing", "completed"].includes(saved.status) && saved.originalName === file.name && saved.sizeBytes === file.size) {
              task = saved;
              item.taskId = saved.id;
              saveBatch();
            }
          } else if (response.status !== 404) await readJson(response);
        }
      }
      if (!task) {
        show(`\u6B63\u5728\u51C6\u5907\u7B2C ${index}/${total} \u4E2A\u6587\u4EF6\uFF1A${file.name}`);
        task = await createTask(file, title);
        item.taskId = task.id;
        saveBatch();
      } else show(`\u7EE7\u7EED\u7B2C ${index}/${total} \u4E2A\u6587\u4EF6\uFF1A${file.name}`);
      activeTask = task.id;
      if (task.status === "completed" || task.status === "completing") {
        const result2 = await retry(async () => readJson(await fetchComplete(task.id)));
        item.resourceId = result2.resourceId || task.resourceId;
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
          if (canceled) throw new Error("\u4E0A\u4F20\u5DF2\u53D6\u6D88\u3002");
          const part = pendingParts[nextPart++];
          const start = (part - 1) * task.partSize;
          const end = Math.min(file.size, start + task.partSize);
          const blob = file.slice(start, end);
          show(`\u7B2C ${index}/${total} \u4E2A\u6587\u4EF6\uFF0C\u6B63\u5728\u4E0A\u4F20\u7B2C ${part}/${task.totalParts} \u7247\u2026\u2026`);
          await retry(async () => {
            const target = task.mode === "local" ? { mode: "local", url: `/api/uploads/${activeTask}/parts/${part}` } : await readJson(
              await fetch(`/api/uploads/${activeTask}/parts/${part}/url`, {
                method: "POST",
                headers: { "x-csrf-token": csrf }
              })
            );
            const uploaded = await fetch(target.url, {
              method: "PUT",
              headers: target.mode === "local" ? { "x-csrf-token": csrf } : {},
              body: blob
            });
            if (!uploaded.ok) await readJson(uploaded);
            if (target.mode === "direct") {
              const etag = uploaded.headers.get("etag");
              if (!etag) throw new Error("R2 \u672A\u8FD4\u56DE ETag\uFF0C\u8BF7\u68C0\u67E5 Bucket CORS\u3002");
              await readJson(
                await fetch(`/api/uploads/${activeTask}/parts/${part}/complete`, {
                  method: "POST",
                  headers: { "content-type": "application/json", "x-csrf-token": csrf },
                  body: JSON.stringify({ etag, sizeBytes: blob.size })
                })
              );
            }
          });
          completedBytes += blob.size;
          updateProgress(bytesBefore + completedBytes, totalBytes);
        }
      };
      const concurrency = 1;
      await Promise.all(Array.from({ length: Math.min(concurrency, pendingParts.length) }, uploadPart));
      show(`\u6B63\u5728\u4FDD\u5B58\u7B2C ${index}/${total} \u4E2A\u6587\u4EF6\u2026\u2026`);
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
    let batch = null, stopAfterFile = false, storage, storageAvailable = true;
    const availableFiles = /* @__PURE__ */ new Map();
    const fileKey = (file) => JSON.stringify([file.name, file.size, file.lastModified]);
    try {
      storage = localStorage;
    } catch {
    }
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
      batchSummary.textContent = `\u5171 ${batch.items.length} \u4EFD \xB7 \u6210\u529F ${done} \xB7 \u5931\u8D25 ${failed} \xB7 \u8DF3\u8FC7 ${skipped} \xB7 \u5F85\u5904\u7406 ${batch.items.length - done - failed - skipped}${storageAvailable ? "" : "\u3002\u6D4F\u89C8\u5668\u65E0\u6CD5\u4FDD\u5B58\u8FDB\u5EA6\uFF0C\u8BF7\u4FDD\u6301\u9875\u9762\u6253\u5F00\u3002"}`;
      batchList.replaceChildren();
      for (const item of batch.items) {
        const row = document.createElement("li");
        const text = document.createElement("span");
        const labels = {
          done: "\u5DF2\u5B8C\u6210",
          failed: "\u5931\u8D25",
          pending: "\u5F85\u4E0A\u4F20",
          uploading: uploading ? "\u6B63\u5728\u4E0A\u4F20" : "\u5F85\u7EE7\u7EED",
          skipped: "\u5DF2\u8DF3\u8FC7"
        };
        text.textContent = `${item.name} \xB7 ${labels[item.state]}${item.error ? " \xB7 " + item.error : ""}`;
        row.append(text);
        if (item.resourceId && item.state === "done") {
          const link = document.createElement("a");
          link.href = `/resources/${Number(item.resourceId)}`;
          link.textContent = "\u67E5\u770B";
          link.target = "_blank";
          link.rel = "noopener";
          row.append(link);
        }
        if (item.state !== "done") {
          const skip = document.createElement("button");
          skip.type = "button";
          skip.className = "secondary";
          skip.disabled = uploading;
          skip.textContent = item.state === "skipped" ? "\u6062\u590D\u5230\u961F\u5217" : "\u8DF3\u8FC7\u6B64\u9879";
          skip.addEventListener(
            "click",
            () => withBatchLock(() => {
              item.state = item.state === "skipped" ? "pending" : "skipped";
              saveBatch();
              renderBatch();
            })
          );
          row.append(skip);
          if (item.taskId && item.state !== "skipped") {
            const abort = document.createElement("button");
            abort.type = "button";
            abort.className = "secondary";
            abort.disabled = uploading;
            abort.textContent = "\u53D6\u6D88\u6B64\u6587\u4EF6\u4EFB\u52A1";
            abort.addEventListener(
              "click",
              () => withBatchLock(async () => {
                if (uploading) return;
                uploading = true;
                renderBatch();
                try {
                  await readJson(
                    await fetch(`/api/uploads/${item.taskId}`, { method: "DELETE", headers: { "x-csrf-token": csrf } })
                  );
                  item.taskId = null;
                  item.state = "skipped";
                  item.error = "\u5DF2\u53D6\u6D88\u4EFB\u52A1";
                } catch (error) {
                  item.error = error.message;
                } finally {
                  uploading = false;
                  saveBatch();
                  renderBatch();
                }
              })
            );
            row.append(abort);
          }
        }
        batchList.append(row);
      }
      submit.textContent = done + skipped === batch.items.length ? "\u672C\u6279\u5904\u7406\u5B8C\u6BD5" : "\u7EE7\u7EED\u5F85\u4F20\u4E0E\u5931\u8D25\u9879";
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
      if (saved?.version === 1 && saved.fields && Array.isArray(saved.items) && saved.items.length <= 1e3) {
        batch = saved;
        restoreFields();
        renderBatch();
        show("\u5DF2\u6062\u590D\u672C\u6279\u8FDB\u5EA6\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u539F\u6587\u4EF6\u4EE5\u7EE7\u7EED\uFF1B\u6210\u529F\u9879\u4E0D\u4F1A\u91CD\u590D\u63D0\u4EA4\u3002");
      }
    } catch {
    }
    fileInput.addEventListener("change", () => {
      for (const file of fileInput.files) availableFiles.set(fileKey(file), file);
      if (batch) show("\u5DF2\u91CD\u65B0\u9009\u62E9\u6587\u4EF6\uFF0C\u70B9\u51FB\u7EE7\u7EED\u4E0A\u4F20\uFF1B\u672A\u9009\u4E2D\u7684\u5F85\u4F20\u9879\u4F1A\u4FDD\u7559\u3002");
    });
    pause.addEventListener("click", () => {
      stopAfterFile = true;
      pause.disabled = true;
      show("\u5F53\u524D\u6587\u4EF6\u5B8C\u6210\u540E\u6682\u505C\uFF0C\u8FDB\u5EA6\u4F1A\u4FDD\u7559\u3002");
    });
    newBatch.addEventListener(
      "click",
      () => withBatchLock(() => {
        if (uploading) return;
        if (batch.items.some((i) => i.state !== "done" && i.state !== "skipped") && !confirm("\u672C\u6279\u4ECD\u6709\u672A\u5B8C\u6210\u6587\u4EF6\u3002\u7ED3\u675F\u540E\u53EA\u80FD\u5230\u201C\u6211\u7684\u8D44\u6599\u201D\u6838\u5BF9\u5DF2\u6210\u529F\u9879\u76EE\uFF0C\u786E\u5B9A\u7ED3\u675F\uFF1F"))
          return;
        batch = null;
        availableFiles.clear();
        saveBatch();
        batchPanel.hidden = true;
        for (const name of fieldNames) if (form.elements[name]) form.elements[name].disabled = false;
        fileInput.value = "";
        fileInput.required = true;
        submit.disabled = false;
        submit.textContent = "\u5F00\u59CB\u4E0A\u4F20";
        show("\u9009\u62E9\u4E0B\u4E00\u6279\u6587\u4EF6\u540E\u5F00\u59CB\u4E0A\u4F20\u3002");
      })
    );
    const submitBatch = async () => {
      if (uploading) return;
      if (!batch) {
        const files = [...fileInput.files];
        if (type.value === "video" || files.some(isVideoFile)) {
          blockVideo();
          return;
        }
        if (!files.length) return show("\u8BF7\u9009\u62E9\u6587\u4EF6\u3002");
        if (files.length > 1e3) return show("\u8BF7\u5C06\u672C\u6279\u63A7\u5236\u57281000\u4EFD\u4EE5\u5185\uFF0C\u5B8C\u6210\u540E\u7EE7\u7EED\u4E0B\u4E00\u6279\u3002");
        if (files.length === 1 && !form.elements.title.value.trim()) return show("\u4E0A\u4F20\u5355\u4E2A\u6587\u4EF6\u65F6\u8BF7\u586B\u5199\u8D44\u6599\u6807\u9898\u3002");
        try {
          const policy = await getPolicy();
          const max = policy.limits[type.value];
          if (!max || files.some((f) => f.size < 1 || f.size > max))
            return show(`\u6B64\u7C7B\u8D44\u6599\u5355\u4E2A\u6587\u4EF6\u4E0A\u9650\u4E3A ${max / 1024 / 1024}MB\u3002`);
        } catch {
          return show("\u6682\u65F6\u65E0\u6CD5\u8BFB\u53D6\u4E0A\u4F20\u9650\u5236\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
        }
        batch = {
          version: 1,
          createdAt: Date.now(),
          fields: Object.fromEntries(fieldNames.map((n) => [n, form.elements[n]?.value || ""])),
          items: files.map((f) => ({ key: fileKey(f), name: f.name, size: f.size, state: "pending" }))
        };
        files.forEach((f) => availableFiles.set(fileKey(f), f));
        saveBatch();
        restoreFields();
      }
      const pending = batch.items.filter((i) => i.state !== "done" && i.state !== "skipped");
      if (!pending.some((i) => availableFiles.has(i.key)))
        return show("\u8BF7\u91CD\u65B0\u9009\u62E9\u539F\u6587\u4EF6\uFF1B\u6D4F\u89C8\u5668\u5237\u65B0\u540E\u4E0D\u80FD\u81EA\u52A8\u8BFB\u53D6\u7535\u8111\u6587\u4EF6\u3002");
      if (batch.retryAt > Date.now())
        return show(`\u4E0A\u4F20\u989D\u5EA6\u6682\u65F6\u7528\u5C3D\uFF0C\u8BF7\u5728 ${new Date(batch.retryAt).toLocaleTimeString()} \u540E\u7EE7\u7EED\u3002\u672C\u6279\u8FDB\u5EA6\u5DF2\u4FDD\u7559\u3002`);
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
            item.error = error.message || "\u4E0A\u4F20\u5931\u8D25\uFF0C\u53EF\u7A0D\u540E\u7EE7\u7EED\u3002";
            if (error.status === 429) {
              batch.retryAt = Date.now() + Math.max(1, error.retryAfter || 60) * 1e3;
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
          batch.items.every((i) => i.state === "done" || i.state === "skipped") ? "\u672C\u6279\u5904\u7406\u5B8C\u6210\uFF0C\u7ED3\u679C\u4FDD\u7559\u5728\u4E0B\u65B9\uFF1B\u53EF\u5F00\u59CB\u4E0B\u4E00\u6279\u3002" : "\u8FDB\u5EA6\u5DF2\u4FDD\u7559\uFF0C\u53EF\u7EE7\u7EED\u5F85\u4F20\u4E0E\u5931\u8D25\u9879\uFF1B\u6210\u529F\u9879\u4E0D\u4F1A\u91CD\u590D\u63D0\u4EA4\u3002"
        );
      }
    };
    const withBatchLock = async (action) => {
      const run = async () => {
        if (uploading) return;
        if (storageAvailable) {
          try {
            const saved = JSON.parse(storage?.getItem(batchKey) || "null");
            if (JSON.stringify(saved) !== JSON.stringify(batch))
              return show("\u6279\u6B21\u5DF2\u88AB\u53E6\u4E00\u6807\u7B7E\u9875\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u540E\u7EE7\u7EED\uFF0C\u907F\u514D\u91CD\u590D\u4E0A\u4F20\u3002");
          } catch {
          }
        }
        return action();
      };
      try {
        if (navigator.locks)
          return await navigator.locks.request(batchKey, { ifAvailable: true }, async (lock) => {
            if (!lock) return show("\u53E6\u4E00\u4E2A\u6807\u7B7E\u9875\u6B63\u5728\u5904\u7406\u672C\u8D26\u53F7\u7684\u4E0A\u4F20\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210\u540E\u5237\u65B0\u672C\u9875\u3002");
            return run();
          });
        return await run();
      } catch {
        show("\u672A\u80FD\u5904\u7406\u4E0A\u4F20\uFF0C\u8BF7\u4FDD\u6301\u9875\u9762\u5E76\u7A0D\u540E\u91CD\u8BD5\u3002");
      }
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      withBatchLock(submitBatch);
    });
  }
})();
