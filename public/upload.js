const form = document.querySelector("#resource-upload");

if (form) {
  const status = document.querySelector("#upload-status");
  const progress = document.querySelector("#upload-progress");
  const percent = document.querySelector("#upload-percent");
  const cancel = document.querySelector("#upload-cancel");
  const submit = form.querySelector('button[type="submit"]');
  const type = form.elements.res_type;
  const fileInput = form.elements.file;
  const csrf = form.dataset.csrf;
  let activeTask = "";
  let storageKey = "";
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
  const readJson = async (response) => {
    const body = await response.json().catch(() => ({ error: "服务器返回异常。" }));
    if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
    return body;
  };
  let policyPromise;
  const getPolicy = () =>
    (policyPromise ??= fetch("/api/uploads/policy")
      .then(readJson)
      .catch((error) => {
        policyPromise = undefined;
        throw error;
      }));
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
      throw new Error("预览图生成或保存失败，请重试；如仍失败，请将图片另存为 JPEG 后上传。已上传的分片会保留。");
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
    fileInput.multiple = photos;
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
        if (
          ["uploading", "completing", "completed"].includes(saved.status) &&
          saved.originalName === file.name &&
          saved.sizeBytes === file.size
        )
          task = saved;
      }
    }
    if (!task) {
      show(`正在准备第 ${index}/${total} 个文件：${file.name}`);
      task = await createTask(file, title);
      localStorage.setItem(storageKey, task.id);
    } else show(`继续第 ${index}/${total} 个文件：${file.name}`);

    activeTask = task.id;
    if (task.status === "completed" || task.status === "completing") {
      await retry(async () => readJson(await fetchComplete(task.id)));
      localStorage.removeItem(storageKey);
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
        updateProgress(bytesBefore + completedBytes, totalBytes);
      }
    };
    const concurrency = 1;
    await Promise.all(Array.from({ length: Math.min(concurrency, pendingParts.length) }, uploadPart));
    show(`正在保存第 ${index}/${total} 个文件……`);
    await retry(async () => readJson(await fetchComplete(activeTask)));
    localStorage.removeItem(storageKey);
    activeTask = "";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const files = [...fileInput.files];
    if (type.value === "video" || files.some(isVideoFile)) {
      blockVideo();
      return;
    }
    if (!files.length) return show("请选择文件。");
    if (files.length > 1 && type.value !== "photo") return show("只有剧照支持一次选择多个文件。");
    if (files.length === 1 && !form.elements.title.value.trim()) return show("上传单个文件时请填写资料标题。");
    try {
      const policy = await getPolicy();
      const maximum = policy.limits[type.value];
      if (!maximum || files.some((file) => file.size < 1 || file.size > maximum))
        return show("此类资料单个文件上限为 " + maximum / 1024 / 1024 + "MB。");
    } catch {
      return show("暂时无法读取上传限制，请刷新后重试。");
    }
    canceled = false;
    uploading = true;
    await keepScreenAwake();
    submit.disabled = true;
    cancel.hidden = false;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    let bytesBefore = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        await uploadOne(files[index], index + 1, files.length, bytesBefore, totalBytes);
        bytesBefore += files[index].size;
      }
      show(`${files.length} 个文件已提交，请在我的资料查看入库或待审核状态。`);
      uploading = false;
      await releaseScreen();
      location.href = "/my-resources";
    } catch (error) {
      show(error.message || "上传失败，可以稍后重试。");
      uploading = false;
      await releaseScreen();
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
      show("当前文件上传已取消。已完成的其他剧照仍会保留，可在我的资料查看状态。");
      activeTask = "";
      uploading = false;
      await releaseScreen();
      cancel.hidden = true;
      submit.disabled = false;
    } catch (error) {
      show(error.message);
    }
  });
}
