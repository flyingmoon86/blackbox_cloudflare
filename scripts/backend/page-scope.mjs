// Lightweight adapter for isolated enhancement unit tests; browser checks use the real runtime.
export const pageScope = {
  listen: (target, type, listener, options) => target?.addEventListener(type, listener, options),
  dispose() {},
  observe: (observer, target, options) => observer.observe(target, options),
};
