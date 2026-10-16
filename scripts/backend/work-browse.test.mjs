import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../../public/work-browse.js", import.meta.url), "utf8");
class Events {
  listeners = new Map();
  addEventListener(type, listener, options = {}) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), { listener, once: options.once }]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
    );
  }
  emit(type, options = {}) {
    for (const entry of [...(this.listeners.get(type) || [])]) {
      entry.listener({ type, ...options });
      if (entry.once) this.removeEventListener(type, entry.listener);
    }
  }
}
function harness({
  saveData = false,
  effectiveType = "4g",
  opening = false,
  stored = null,
  navigation = "navigate",
} = {}) {
  const requests = [],
    images = [],
    timers = new Map(),
    frames = [];
  const connection = Object.assign(new Events(), { saveData, effectiveType });
  const navigator = { connection, onLine: true };
  const window = Object.assign(new Events(), { blackboxSiteOpening: { active: opening }, scrollY: 800 });
  const document = Object.assign(new Events(), { hidden: false, body: {}, documentElement: {} });
  document.activeElement = document.body;
  let observer;
  const cards = Array.from({ length: 12 }, (_, index) => {
    const card = {
      dataset: { workPreview: `/productions/${index + 1}/cover?size=preview&previewOnly=1&v=${index + 1}` },
    };
    const link = {
      href: `https://work.test/productions/${index + 1}`,
      target: "",
      closest: () => card,
      hasAttribute: () => false,
      focus: (options) => {
        document.activeElement = link;
        link.focusOptions = options;
      },
    };
    card.closest = () => card;
    card.querySelectorAll = () => [link];
    card.link = link;
    return card;
  });
  document.querySelectorAll = (selector) => (selector === "[data-work-card]" ? cards : []);
  document.querySelector = () => null;
  const storage = new Map(stored ? [["blackbox-work-return:v1", JSON.stringify(stored)]] : []);
  const location = new URL("https://work.test/productions?q=合成");
  const context = {
    window,
    document,
    navigator,
    location,
    URL,
    Date,
    performance: { getEntriesByType: () => [{ type: navigation }] },
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: (fn) => {
      const id = Symbol();
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    Image: class extends Events {
      complete = false;
      constructor() {
        super();
        images.push(this);
      }
      set src(url) {
        this.url = url;
        requests.push(url);
      }
      removeAttribute(name) {
        if (name === "src") this.cancelled = true;
      }
    },
    IntersectionObserver: class {
      observed = new Set();
      constructor(callback) {
        observer = this;
        this.callback = callback;
      }
      observe(card) {
        this.observed.add(card);
      }
      unobserve(card) {
        this.observed.delete(card);
      }
      disconnect() {
        this.observed.clear();
      }
      intersect(targets) {
        this.callback(
          targets.filter((target) => this.observed.has(target)).map((target) => ({ target, isIntersecting: true })),
        );
      }
    },
  };
  window.IntersectionObserver = context.IntersectionObserver;
  window.scrollTo = (value) => {
    window.scrolled = value;
  };
  vm.runInNewContext(source, context);
  return { cards, requests, images, window, document, navigator, connection, observer, timers, frames, storage };
}

test("work candidates bound viewport to four, total to eight and concurrency to two", () => {
  const s = harness();
  s.observer.intersect(s.cards);
  assert.equal(s.requests.length, 2);
  s.images[0].emit("load");
  s.images[1].emit("error");
  assert.equal(s.requests.length, 4);
  s.images[2].emit("load");
  s.images[3].emit("load");
  for (const card of s.cards) s.document.emit("focusin", { target: card });
  assert.equal(s.requests.length, 6);
  s.images[4].emit("load");
  s.images[5].emit("load");
  s.images[6].emit("load");
  s.images[7].emit("load");
  assert.equal(s.requests.length, 8);
  assert.equal(new Set(s.requests).size, 8);
  assert.ok(s.requests.every((url) => url.includes("previewOnly=1")));
});

test("work warming obeys data saving, slow connection, offline and opening completion", () => {
  for (const options of [
    { saveData: true },
    { effectiveType: "slow-2g" },
    { effectiveType: "2g" },
    { opening: true },
  ]) {
    const s = harness(options);
    s.observer.intersect(s.cards);
    s.document.emit("focusin", { target: s.cards[0] });
    assert.equal(s.requests.length, 0);
    s.connection.saveData = false;
    s.connection.effectiveType = "4g";
    s.window.blackboxSiteOpening.active = false;
    s.document.emit("blackbox:opening-finished");
    s.observer.intersect(s.cards);
    assert.equal(s.requests.length, 2);
    s.navigator.onLine = false;
    s.window.emit("offline");
    assert.ok(s.images.every((image) => image.cancelled));
    s.document.emit("focusin", { target: s.cards[7] });
    assert.equal(s.requests.length, 2);
  }
});

test("work navigation cancellation stops queued transfers without visibility resuming navigation", () => {
  const s = harness();
  s.observer.intersect(s.cards);
  s.document.emit("blackbox:navigation-start");
  assert.ok(s.images.every((image) => image.cancelled));
  s.document.hidden = true;
  s.document.emit("visibilitychange");
  s.document.hidden = false;
  s.document.emit("visibilitychange");
  s.document.emit("focusin", { target: s.cards[7] });
  assert.equal(s.requests.length, 2);
  s.document.emit("blackbox:navigation-cancel");
  s.document.emit("focusin", { target: s.cards[7] });
  assert.equal(s.requests.length, 3);
  assert.ok(s.requests.at(-1).includes("/8/cover"));
});

test("work speculative timeout drains budget and invalid or touch-only candidates are ignored", () => {
  const s = harness();
  for (const value of [
    "https://elsewhere.test/productions/1/cover?size=preview&previewOnly=1&v=1",
    "/productions/1/cover?size=preview&v=1",
    "/resources/1/download",
    "/productions/1/cover?size=preview&previewOnly=1&v=x",
  ]) {
    s.cards[0].dataset.workPreview = value;
    s.document.emit("focusin", { target: s.cards[0] });
  }
  s.document.emit("pointerover", { pointerType: "touch", target: s.cards[1] });
  assert.equal(s.requests.length, 0);
  s.observer.intersect(s.cards.slice(1));
  assert.equal(s.requests.length, 2);
  [...s.timers.values()].forEach((fn) => fn());
  assert.equal(s.requests.length, 4);
  [...s.timers.values()].forEach((fn) => fn());
  assert.equal(s.timers.size, 0);
});

test("work return restores query, scroll and focus while preserving later user interaction", () => {
  const s = harness({
    stored: {
      url: "/productions?q=合成",
      to: "/productions/5",
      focus: "/productions/5",
      y: 800,
      at: Date.now(),
      explicit: true,
    },
  });
  // URL pathname/search are serialized by the browser when the source link is saved.
  const pending = JSON.parse(s.storage.get("blackbox-work-return:v1"));
  pending.url = "/productions?q=%E5%90%88%E6%88%90";
  s.storage.set("blackbox-work-return:v1", JSON.stringify(pending));
  s.document.emit("DOMContentLoaded");
  s.frames.shift()();
  assert.equal(s.window.scrolled.top, 800);
  assert.equal(s.document.activeElement, s.cards[4].link);
  assert.equal(s.cards[4].link.focusOptions.preventScroll, true);
  s.window.emit("pageshow", { persisted: false });
  assert.equal(s.frames.length, 0, "late image completion must not restore a second time");
  s.window.emit("wheel");
  s.window.emit("pageshow", { persisted: true });
  s.window.emit("wheel");
  s.document.activeElement = s.document.body;
  s.frames.shift()();
  assert.equal(
    s.document.activeElement,
    s.document.body,
    "BFCache return must not consume an obsolete once-only interaction handler",
  );
});
