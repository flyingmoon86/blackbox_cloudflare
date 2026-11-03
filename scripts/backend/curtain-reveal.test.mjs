import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function mounted({ duration = "2.6s", reduced = false } = {}) {
  class Node extends EventTarget {
    constructor(tag = "div") {
      super();
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.className = "";
      this.dataset = {};
      this.open = false;
    }
    append(...nodes) {
      nodes.forEach((node) => (node.parent = this));
      this.children.push(...nodes);
    }
    prepend(node) {
      node.parent = this;
      this.children.unshift(node);
    }
    before(node) {
      this.parent.append(node);
    }
    set innerHTML(value) {
      const panel = new Node();
      panel.className = "curtain-panel";
      for (const name of ["curtain-label", "curtain-detail"]) {
        const n = new Node();
        n.className = name;
        panel.append(n);
      }
      this.append(panel);
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    removeAttribute(name) {
      delete this[name];
    }
    addClass(name) {
      this.className += " " + name;
    }
    querySelectorAll(selector) {
      const name = selector.startsWith(".") ? selector.slice(1) : selector.toUpperCase();
      return this.children.flatMap((n) => [
        ...((selector.startsWith(".") ? n.className.split(" ").includes(name) : n.tagName === name) ? [n] : []),
        ...n.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
      this.closes = (this.closes || 0) + 1;
    }
    remove() {
      this.removed = true;
    }
  }
  const document = new EventTarget(),
    window = new EventTarget(),
    body = new Node(),
    html = new Node(),
    timers = new Map(),
    frames = [];
  const motion = Object.assign(new EventTarget(), { matches: reduced });
  document.body = body;
  document.documentElement = html;
  document.readyState = "complete";
  document.referrer = "";
  document.currentScript = { dataset: { siteOpening: "test" }, hasAttribute: () => true };
  document.createElement = (tag) => new Node(tag);
  document.querySelector = () => null;
  const sandbox = {
    window,
    document,
    URL,
    Date,
    CustomEvent,
    HTMLScriptElement: Node,
    location: new URL("https://blackbox.test/"),
    navigator: { onLine: true },
    performance: { getEntriesByType: () => [] },
    matchMedia: () => motion,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    getComputedStyle: (node) => ({ getPropertyValue: () => "1", animationDuration: duration, animationDelay: "0s" }),
    requestAnimationFrame: (fn) => frames.push(fn),
    setTimeout: (fn, ms) => {
      timers.set(ms, fn);
      return ms;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(readFileSync("public/curtain-boot.js", "utf8"), sandbox);
  const curtain = body.children[0];
  return {
    window,
    document,
    curtain,
    timers,
    frames,
    motion,
    async reveal() {
      window.blackboxSiteOpening.finish({ status: "ready" });
      await new Promise((resolve) => setImmediate(resolve));
    },
    paint() {
      const fs = frames.splice(0);
      fs.forEach((fn) => fn());
    },
    end(name, target) {
      const e = new Event("animationend");
      Object.defineProperties(e, { animationName: { value: name }, target: { value: target } });
      curtain.dispatchEvent(e);
    },
  };
}
test("reveal starts after closed frames and remains modal until BOTH cloth wings finish", async () => {
  const f = mounted();
  await f.reveal();
  assert.equal(f.curtain.className, "blackbox-curtain is-settling");
  assert.equal(f.curtain.open, true);
  f.paint();
  assert.equal(f.curtain.className, "blackbox-curtain is-settling");
  f.paint();
  assert.equal(f.curtain.className, "blackbox-curtain is-revealing");
  const wings = f.curtain.querySelectorAll(".curtain-wing");
  assert.equal(wings.length, 2);
  f.end("curtain-reveal-depth", f.curtain.querySelector(".curtain-atmosphere"));
  assert.equal(f.curtain.removed, undefined);
  f.end("curtain-reveal-left", wings[0]);
  assert.equal(f.curtain.removed, undefined);
  f.end("curtain-reveal-right", wings[1]);
  assert.equal(f.curtain.removed, true);
  assert.equal(f.curtain.closes, 1);
});
test("fallback follows actual CSS seconds beyond two seconds", async () => {
  const f = mounted({ duration: "4.2s" });
  await f.reveal();
  f.paint();
  f.paint();
  assert.ok(f.timers.has(4450));
  assert.equal(f.timers.has(2120), false);
  f.timers.get(4450)();
  assert.equal(f.curtain.removed, true);
});
test("an unrelated rejection during the completed reveal does not cut it off", async () => {
  const f = mounted();
  await f.reveal();
  f.paint();
  f.paint();
  f.window.dispatchEvent(new Event("unhandledrejection"));
  assert.equal(f.curtain.removed, undefined);
  assert.equal(f.window.blackboxSiteOpening.status, "ready");
  const wings = f.curtain.querySelectorAll(".curtain-wing");
  f.end("curtain-reveal-left", wings[0]);
  f.end("curtain-reveal-right", wings[1]);
  assert.equal(f.curtain.removed, true);
});
test("reduced motion releases a prepared curtain without waiting for animation", async () => {
  const f = mounted({ reduced: true });
  await f.reveal();
  assert.equal(f.curtain.removed, true);
  assert.equal(f.frames.length, 0);
});
test("Escape can skip the reveal after preparation, while loading stays guarded", async () => {
  const f = mounted();
  const loadingCancel = new Event("cancel", { cancelable: true });
  f.curtain.dispatchEvent(loadingCancel);
  assert.equal(loadingCancel.defaultPrevented, true);
  assert.equal(f.curtain.removed, undefined);
  await f.reveal();
  const cancel = new Event("cancel", { cancelable: true });
  f.curtain.dispatchEvent(cancel);
  assert.equal(f.curtain.removed, true);
  f.paint();
  assert.equal(f.frames.length, 0);
});
