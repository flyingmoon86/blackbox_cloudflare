// Page enhancements have an explicit lifetime; the shell stays mounted.
(() => {
  const features = new Map();
  let root;
  let navigation = "initial";
  const report = (feature, phase) => console.error("页面组件执行失败", { feature: feature.name, phase });
  const start = (feature) => {
    feature.stop?.();
    if (!root) return;
    const controller = new AbortController();
    const cleanup = [];
    const dispose = (callback) => {
      try {
        callback();
      } catch {
        // One failing cleanup must not leave the remaining page alive.
        report(feature, "cleanup");
      }
    };
    const scope = {
      signal: controller.signal,
      navigation,
      listen(target, type, listener, options = {}) {
        target?.addEventListener(type, listener, {
          ...(typeof options === "boolean" ? { capture: options } : options),
          signal: controller.signal,
        });
      },
      dispose(callback) {
        if (controller.signal.aborted) dispose(callback);
        else cleanup.push(callback);
      },
      observe(observer, target, options) {
        if (controller.signal.aborted) return;
        observer.observe(target, options);
        cleanup.push(() => observer.disconnect());
      },
    };
    feature.stop = () => {
      feature.stop = undefined;
      controller.abort();
      cleanup.splice(0).reverse().forEach(dispose);
    };
    try {
      feature.setup(root, scope);
    } catch {
      report(feature, "setup");
      feature.stop?.();
    }
  };
  window.blackboxPages = {
    register(name, setup) {
      features.get(name)?.stop?.();
      const feature = { name, setup };
      features.set(name, feature);
      start(feature);
    },
    unmount() {
      for (const feature of features.values()) feature.stop?.();
      root = null;
    },
    mount(next, reason = "initial") {
      root = next;
      navigation = reason;
      for (const feature of features.values()) start(feature);
    },
  };
  const ready = () => window.blackboxPages.mount(document.querySelector("#main-content"));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
  else ready();
})();
