import { imageSource } from "./discovery.js";
export function createAssetWarmer() {
  const assets = new Map();
  const warm = (url, image = false) => {
    if (assets.has(url)) return assets.get(url).promise;
    const controller = new AbortController();
    const entry = { controller, ready: false };
    assets.set(url, entry);
    const timeout = setTimeout(() => controller.abort(), 6000);
    const work = image
      ? new Promise((resolve, reject) => {
          const existing = [...document.querySelectorAll("img[src]")].find(
            (node) => imageSource(node, location.href) === url,
          );
          const photo = existing || new Image();
          let settled = false;
          const done = (error) => {
            if (settled) return;
            settled = true;
            photo.removeEventListener("load", loaded);
            photo.removeEventListener("error", failed);
            controller.signal.removeEventListener("abort", aborted);
            if (error) reject(error);
            else resolve();
          };
          const loaded = () => {
            if (!photo.naturalWidth) return failed();
            if (typeof photo.decode === "function") photo.decode().then(() => done(), done);
            else done();
          };
          const failed = () => done(new Error("navigation-image"));
          const aborted = () => {
            if (!existing) photo.removeAttribute("src");
            done(new Error("navigation-aborted"));
          };
          photo.addEventListener("load", loaded, { once: true });
          photo.addEventListener("error", failed, { once: true });
          controller.signal.addEventListener("abort", aborted, { once: true });
          photo.loading = "eager";
          if (!existing) {
            photo.fetchPriority = "low";
            photo.src = url;
          }
          if (photo.complete) (photo.naturalWidth ? loaded : failed)();
        })
      : fetch(url, { priority: "low", signal: controller.signal })
          .then((response) => {
            if (!response.ok || response.redirected) throw new Error("navigation-asset");
            return response.arrayBuffer();
          })
          .then(() => {});
    entry.promise = work
      .then(() => {
        entry.ready = true;
      })
      .catch((error) => {
        if (assets.get(url) === entry) assets.delete(url);
        throw error;
      })
      .finally(() => clearTimeout(timeout));
    return entry.promise;
  };
  const abort = () => {
    for (const [url, entry] of assets) {
      if (!entry.ready) {
        assets.delete(url);
        entry.controller.abort();
      }
    }
  };
  return { warm, abort };
}
