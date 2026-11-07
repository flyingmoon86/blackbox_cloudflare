const metadata = document.querySelector("[data-three-d-metadata]");
if (metadata) {
  const production = metadata.elements.production_id;
  const edition = metadata.elements.edition_id;
  const filterEditions = () => {
    for (const option of edition.options) {
      if (!option.value) continue;
      option.hidden = option.disabled = option.dataset.production !== production.value;
      if (option.selected && option.disabled) edition.value = "";
    }
    edition.disabled = !production.value;
  };
  production.addEventListener("change", filterEditions);
  filterEditions();
}

const panel = document.querySelector("[data-three-d-upload]");
if (panel && metadata) {
  const modelForm = panel.querySelector("[data-three-d-model]");
  const modelInput = modelForm.elements.model;
  const modelStart = panel.querySelector("[data-three-d-model-start]");
  const pause = panel.querySelector("[data-three-d-pause]");
  const cancel = panel.querySelector("[data-three-d-cancel]");
  const progress = panel.querySelector("progress");
  const percent = panel.querySelector("[data-three-d-percent]");
  const modelStatus = panel.querySelector("[data-three-d-model-status]");
  const coverForm = panel.querySelector("[data-three-d-cover]");
  const coverInput = coverForm.elements.cover;
  const coverStart = coverForm.querySelector('button[type="submit"]');
  const coverStatus = panel.querySelector("[data-three-d-cover-status]");
  const publication = document.querySelector("[data-three-d-publication]");
  const endpoint = "/api/admin/3d/scenes/" + encodeURIComponent(panel.dataset.scene);
  const metadataValues = () => new URLSearchParams(new FormData(metadata)).toString();
  const initialMetadata = metadataValues();
  let activeTask = null;
  let operation = "";
  let pauseRequested = false;
  let finishing = false;

  function renderControls() {
    const busy = Boolean(operation);
    metadata.inert = busy;
    if (publication) publication.inert = busy;
    modelInput.disabled = coverInput.disabled = modelStart.disabled = coverStart.disabled = busy;
    modelStart.textContent = activeTask ? "继续上传模型" : "上传模型";
    pause.hidden = operation !== "model" || finishing;
    pause.disabled = pauseRequested;
    cancel.hidden = !activeTask || activeTask.status !== "uploading";
    cancel.disabled = busy;
  }

  function updateProgress(bytes, total) {
    progress.max = total || 1;
    progress.value = bytes;
    percent.textContent = Math.min(100, Math.round((bytes / (total || 1)) * 100)) + "%";
  }

  function bytesUploaded(parts) {
    return parts.reduce((size, part) => size + part.sizeBytes, 0);
  }

  async function request(path, { method = "GET", body, type, optional = false } = {}) {
    const headers = {};
    if (method !== "GET") headers["x-csrf-token"] = panel.dataset.csrf;
    if (type) headers["content-type"] = type;
    const response = await fetch(endpoint + path, { method, body, headers, cache: "no-store" });
    if (optional && response.status === 404) return null;
    const result = await response.json().catch(() => null);
    if (response.redirected || !response.ok || !result) {
      const error = new Error(
        response.redirected || response.status === 401 || response.status === 403
          ? "登录状态已失效，请刷新页面后重试。"
          : result?.error || `操作失败（${response.status}）。`,
      );
      error.status = response.status;
      throw error;
    }
    return result;
  }

  async function retry(action) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 650 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async function fileFingerprint(file) {
    if (!globalThis.crypto?.subtle) throw new Error("请通过 HTTPS 或本地开发地址上传模型。");
    // Sample evenly across the file to catch accidental selection of a different revision when resuming.
    const block = 64 * 1024;
    const samples = [];
    for (let i = 0; i < 16; i += 1) {
      const offset = Math.floor((Math.max(0, file.size - block) * i) / 15);
      samples.push(file.slice(offset, offset + block));
    }
    const input = await new Blob([String(file.size), "\n", ...samples]).arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function requireSavedMetadata() {
    if (metadataValues() !== initialMetadata) throw new Error("请先保存场景信息，再上传文件。");
  }

  async function withSceneLock(action) {
    if (!navigator.locks) return action();
    return navigator.locks.request("blackbox-three-d:" + panel.dataset.scene, { ifAvailable: true }, (lock) => {
      if (!lock) throw new Error("另一个标签页正在处理这个场景，请稍后重试。");
      return action();
    });
  }

  function finishUpload(status, message) {
    status.textContent = message;
    // The server has updated the scene revision and the edit form was locked during upload.
    operation = "";
    location.reload();
  }

  async function uploadModel(file) {
    if (!file || !file.size || !/\.ply$/i.test(file.name)) throw new Error("请选择非空的高斯 PLY 文件。");
    if (file.size > 512 * 1024 * 1024) throw new Error("模型不能超过 512 MiB。请压缩后重试。");
    requireSavedMetadata();
    operation = "model";
    pauseRequested = false;
    finishing = false;
    renderControls();
    try {
      await withSceneLock(async () => {
        modelStatus.textContent = "正在检查文件与续传进度…";
        const fingerprint = await fileFingerprint(file);
        activeTask = await request("/uploads/current", { optional: true });
        if (
          activeTask &&
          (activeTask.originalName !== file.name ||
            activeTask.sizeBytes !== file.size ||
            activeTask.fingerprint !== fingerprint)
        )
          throw new Error("选择的文件与已有上传任务不同。请选择原文件续传，或取消旧任务后再上传。");
        if (!activeTask) {
          if (pauseRequested) {
            modelStatus.textContent = "已暂停，可以重新开始。";
            return;
          }
          activeTask = await request("/uploads", {
            method: "POST",
            type: "application/json",
            body: JSON.stringify({ originalName: file.name, sizeBytes: file.size, fingerprint }),
          });
        }
        const taskPath = "/uploads/" + encodeURIComponent(activeTask.id);
        const uploaded = new Set(activeTask.parts.map((part) => part.partNumber));
        let bytes = bytesUploaded(activeTask.parts);
        updateProgress(bytes, file.size);
        for (let number = 1; number <= activeTask.totalParts; number += 1) {
          if (pauseRequested) break;
          if (uploaded.has(number)) continue;
          const start = (number - 1) * activeTask.partSize;
          const part = file.slice(start, start + activeTask.partSize);
          modelStatus.textContent = `正在上传第 ${number}/${activeTask.totalParts} 个分片…`;
          await retry(() =>
            request(taskPath + "/parts/" + number, { method: "PUT", body: part, type: "application/octet-stream" }),
          );
          bytes += part.size;
          updateProgress(bytes, file.size);
        }
        if (pauseRequested) {
          modelStatus.textContent = "已暂停。点「继续上传模型」可从已完成的分片继续。";
          return;
        }
        finishing = true;
        renderControls();
        modelStatus.textContent = "正在合并分片并验证模型…";
        await retry(() => request(taskPath + "/complete", { method: "POST" }));
        finishUpload(modelStatus, "模型已上传。正在刷新以显示待发布文件…");
      });
    } finally {
      operation = "";
      renderControls();
    }
  }

  async function makeCover(file) {
    if (!file || !file.size || !/\.(?:jpe?g|png|webp)$/i.test(file.name))
      throw new Error("请选择 JPG、PNG 或 WebP 图片。");
    if (file.size > 20 * 1024 * 1024) throw new Error("请选择小于或等于 20 MiB 的封面原图。");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      try {
        await image.decode();
      } catch {
        throw new Error("无法读取这张封面，请换一张图片重试。");
      }
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("此浏览器无法转换封面。");
      context.fillStyle = "#15130f";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
      if (!jpeg || jpeg.size > 1500000) throw new Error("封面转换失败，请换一张较小的图片。");
      return jpeg;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function uploadCover(file) {
    requireSavedMetadata();
    operation = "cover";
    renderControls();
    try {
      await withSceneLock(async () => {
        coverStatus.textContent = "正在转换封面…";
        const jpeg = await makeCover(file);
        coverStatus.textContent = "正在上传封面…";
        await request("/cover", { method: "PUT", body: jpeg, type: "image/jpeg" });
        finishUpload(coverStatus, "封面已上传。正在刷新以显示待发布文件…");
      });
    } finally {
      operation = "";
      renderControls();
    }
  }

  modelForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (operation) return;
    uploadModel(modelInput.files[0]).catch((error) => {
      modelStatus.textContent = error.message || "上传失败，可以重新选择原文件继续。";
    });
  });
  coverForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (operation) return;
    uploadCover(coverInput.files[0]).catch((error) => {
      coverStatus.textContent = error.message || "封面上传失败，请重试。";
    });
  });
  pause.addEventListener("click", () => {
    pauseRequested = true;
    pause.disabled = true;
    modelStatus.textContent = "当前分片传完后暂停…";
  });
  cancel.addEventListener("click", async () => {
    if (operation || !activeTask || !window.confirm("取消这次模型上传？已发布的模型会保留。")) return;
    operation = "cancel";
    renderControls();
    try {
      await withSceneLock(() => request("/uploads/" + encodeURIComponent(activeTask.id), { method: "DELETE" }));
      activeTask = null;
      modelInput.value = "";
      updateProgress(0, 1);
      modelStatus.textContent = "已取消，可以选择新文件上传。";
    } catch (error) {
      modelStatus.textContent = error.message || "暂时无法取消，请刷新后重试。";
    } finally {
      operation = "";
      renderControls();
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (!operation || operation === "inspect") return;
    event.preventDefault();
    event.returnValue = true;
  });

  operation = "inspect";
  renderControls();
  request("/uploads/current", { optional: true })
    .then((task) => {
      activeTask = task;
      if (!task) return;
      updateProgress(bytesUploaded(task.parts), task.sizeBytes);
      modelStatus.textContent = `有未完成的任务：${task.originalName}。重新选择原文件即可续传。`;
    })
    .catch((error) => {
      modelStatus.textContent = error.message || "暂时无法检查上传进度。";
    })
    .finally(() => {
      operation = "";
      renderControls();
    });
}
