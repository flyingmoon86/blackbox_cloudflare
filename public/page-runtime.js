// Page enhancements have an explicit lifetime; the shell stays mounted.
(() => {
  const features = new Map();
  let root;
  const start = (feature) => {
    feature.stop?.();
    if (!root) return;
    const controller = new AbortController();
    const cleanup = [];
    const scope = {
      signal: controller.signal,
      listen(target, type, listener, options = {}) {
        target?.addEventListener(type, listener, {
          ...(typeof options === "boolean" ? { capture: options } : options),
          signal: controller.signal,
        });
      },
      dispose(callback) {
        cleanup.push(callback);
      },
      observe(observer, target, options) {
        observer.observe(target, options);
        cleanup.push(() => observer.disconnect());
      },
    };
    feature.stop = () => {
      controller.abort();
      cleanup.splice(0).forEach((callback) => callback());
    };
    feature.setup(root, scope);
  };
  window.blackboxPages = {
    register(name, setup) {
      features.get(name)?.stop?.();
      const feature = { setup };
      features.set(name, feature);
      start(feature);
    },
    unmount() {
      for (const feature of features.values()) feature.stop?.();
      root = null;
    },
    mount(next) {
      root = next;
      for (const feature of features.values()) start(feature);
    },
  };
  const ready = () => window.blackboxPages.mount(document.querySelector("#main-content"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
