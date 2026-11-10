import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const source = buildSync({
  entryPoints: ["src/client/shared/list-return.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "ListReturn",
}).outputFiles[0].text;
const pending = (overrides = {}) => ({
  url: "/items?q=stage&page=2",
  to: "/items/7",
  focus: "/items/7?q=stage&page=2",
  y: 720,
  mainY: 40,
  at: Date.now(),
  explicit: true,
  ...overrides,
});

function harness({ value = pending(), navigation = "initial", load = "navigate", blocked = false } = {}) {
  const window = Object.assign(new EventTarget(), { scrollY: 300, scrollX: 0 });
  const root = Object.assign(new EventTarget(), { isConnected: true, scrollTop: 0, scrollLeft: 0 });
  const document = Object.assign(new EventTarget(), {
    body: {},
    documentElement: {},
    readyState: "complete",
    querySelector: () => root,
  });
  document.activeElement = document.body;
  const link = {
    href: "https://return.test/items/7?q=stage&page=2",
    target: "",
    hasAttribute: () => false,
    closest: () => link,
    matches: () => true,
    focus(options) {
      assert.equal(options.preventScroll, true);
      document.activeElement = link;
    },
  };
  root.querySelectorAll = (selector) => (selector === "[data-item]" ? [link] : []);
  const frames = new Map();
  let frameId = 0;
  let stored = typeof value === "string" ? value : value && JSON.stringify(value);
  let writes = 0;
  const scrolls = [];
  window.scrollTo = (position) => scrolls.push(position);
  const context = vm.createContext({
    window,
    document,
    root,
    AbortController,
    URL,
    Date,
    location: new URL("https://return.test/items?q=stage&page=2"),
    performance: { getEntriesByType: () => [{ type: load }] },
    requestAnimationFrame: (callback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    sessionStorage: {
      getItem() {
        if (blocked) throw Error("storage disabled");
        return stored;
      },
      setItem(_, next) {
        if (blocked) throw Error("storage disabled");
        stored = next;
        writes++;
      },
    },
  });
  vm.runInContext(readFileSync("public/page-runtime.js", "utf8"), context);
  window.blackboxPages.mount(root, navigation);
  vm.runInContext(source, context);
  vm.runInContext(
    `window.blackboxPages.register("list-return", (root, scope) => ListReturn.installListReturn(root, scope, {
      storageKey: "return", listPath: "/items", cardSelector: "[data-item]", returnSelector: "[data-return]",
      detailPath: /^\\/items\\/\\d+$/,
    }));`,
    context,
  );
  return {
    window,
    root,
    link,
    document,
    frames,
    scrolls,
    get writes() {
      return writes;
    },
    get stored() {
      return JSON.parse(stored);
    },
    flush() {
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback();
    },
    click(options = {}) {
      const event = Object.assign(new Event("click", { cancelable: true }), { button: 0, ...options });
      Object.defineProperty(event, "target", { value: link });
      if (options.cancelled) event.preventDefault();
      root.dispatchEvent(event);
    },
  };
}

test("explicit return restores scroll and card focus once; native history owns its own position", () => {
  const explicit = harness();
  explicit.flush();
  assert.equal(explicit.scrolls[0].top, 720);
  assert.equal(explicit.root.scrollTop, 40);
  assert.equal(explicit.document.activeElement, explicit.link);
  assert.equal(explicit.stored.explicit, false);
  explicit.window.dispatchEvent(new Event("pageshow"));
  assert.equal(explicit.frames.size, 0);

  const history = harness({ load: "back_forward", value: pending({ explicit: false }) });
  history.flush();
  assert.equal(history.document.activeElement, history.link);
  assert.equal(history.scrolls.length, 0);
});

test("ordinary entry and cached mounts never reuse a previous detail position", () => {
  for (const [navigation, load] of [
    ["initial", "navigate"],
    ["push", "back_forward"],
    ["history", "back_forward"],
  ]) {
    const state = harness({ navigation, load, value: pending({ explicit: false }) });
    assert.equal(state.frames.size, 0);
    assert.equal(state.writes, 0);
  }
});

test("unmount cancels queued recovery and listeners; later user input also wins", () => {
  const unmounted = harness();
  assert.equal(unmounted.frames.size, 1);
  unmounted.window.blackboxPages.unmount();
  assert.equal(unmounted.frames.size, 0);
  const before = unmounted.writes;
  unmounted.click();
  assert.equal(unmounted.writes, before);
  for (const type of ["pointerdown", "wheel", "touchstart", "keydown"]) {
    const state = harness();
    state.window.dispatchEvent(new Event(type));
    state.flush();
    assert.equal(state.scrolls.length, 0);
    assert.equal(state.document.activeElement, state.document.body);
  }
});

test("cancelled or modified clicks do not replace the original return context", () => {
  const state = harness({ value: null });
  for (const options of [{ cancelled: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])
    state.click(options);
  state.link.target = "_blank";
  state.click();
  assert.equal(state.writes, 0);
  state.link.target = "_self";
  state.click();
  assert.equal(state.writes, 1);
  assert.equal(state.stored.url, "/items?q=stage&page=2");
  assert.equal(state.stored.y, 300);
  assert.equal(state.stored.explicit, false);
});

test("expired, foreign, malformed and mismatched records cannot restore a list", () => {
  for (const value of [
    "invalid JSON",
    "x".repeat(4097),
    pending({ url: "https://elsewhere.test/items?q=stage&page=2" }),
    pending({ url: "/items?q=different&page=2" }),
    pending({ focus: "https://elsewhere.test/items/7" }),
    pending({ to: "/items/8" }),
    pending({ y: -1 }),
    pending({ mainY: "900" }),
    pending({ at: Date.now() - 31 * 60 * 1000 }),
    pending({ at: Date.now() + 60000 }),
  ])
    assert.equal(harness({ value }).frames.size, 0);
  const blocked = harness({ blocked: true });
  assert.equal(blocked.frames.size, 0);
  assert.doesNotThrow(() => blocked.click());
});
