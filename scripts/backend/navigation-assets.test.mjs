import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Exercise the public asset loader with browser-style event timing: a parser
// stylesheet can have failed before the deferred navigation script starts.
function fixture({ sheet = null, retry = "load" } = {}) {
  const href = "https://fixture.invalid/assets/app.0123456789abcdef.css";
  const nodes = [];
  let transfers = 0;
  const start = (node) => {
    transfers++;
    if (retry === "pending") return;
    queueMicrotask(() => {
      node.sheet = retry === "load" ? {} : null;
      node.dispatchEvent(new Event(retry));
    });
  };
  class Link extends EventTarget {
    constructor() {
      super();
      this._href = href;
      this.sheet = null;
      this.rel = "stylesheet";
      this.isConnected = false;
      this.media = "all";
    }
    get href() {
      return this._href;
    }
    set href(value) {
      this._href = value;
      if (this.isConnected) start(this);
    }
    closest() {
      return null;
    }
    cloneNode() {
      const copy = new Link();
      copy._href = this.href;
      copy.media = this.media;
      return copy;
    }
    replaceWith(copy) {
      const index = nodes.indexOf(this);
      if (index >= 0) nodes.splice(index, 1, copy);
      this.isConnected = false;
      copy.isConnected = true;
      start(copy);
    }
    remove() {
      const index = nodes.indexOf(this);
      if (index >= 0) nodes.splice(index, 1);
      this.isConnected = false;
    }
    setAttribute(name, value) {
      this[name] = value;
    }
    getAttribute(name) {
      return this[name] ?? null;
    }
  }
  const original = new Link();
  original.sheet = sheet;
  original.isConnected = true;
  nodes.push(original);
  const document = {
    querySelectorAll(selector) {
      return selector.includes("stylesheet") ? nodes : [];
    },
    createElement() {
      return new Link();
    },
    head: {
      append(node) {
        if (!nodes.includes(node)) nodes.push(node);
        if (!node.isConnected) {
          node.isConnected = true;
          start(node);
        }
      },
      replaceChild(next, old) {
        old.replaceWith(next);
      },
    },
  };
  original.parentNode = document.head;
  // Deliver the error before the asset helper can attach a listener.
  if (!sheet) original.dispatchEvent(new Event("error"));
  const source = readFileSync("src/client/navigation/assets.js", "utf8")
    .replace(/^import .*image-source\.js";\r?\n/m, "")
    .replaceAll("export function ", "function ");
  const sandbox = {
    document,
    location: { href: "https://fixture.invalid/", origin: "https://fixture.invalid" },
    URL,
    DOMException,
    imageSource() {
      throw Error("These cases do not request images");
    },
  };
  vm.runInNewContext(source + "\nglobalThis.makeAssets = createNavigationAssets;", sandbox);
  const controller = new AbortController();
  const assets = sandbox.makeAssets(controller.signal);
  return { assets, controller, document, transfers: () => transfers };
}

async function promptly(promise, controller) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error("Asset loader waited for a lost stylesheet event")), 150);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("a stylesheet that failed before loader startup can recover without the global deadline", async () => {
  const f = fixture();
  await promptly(f.assets.styles(f.document), f.controller);
  assert.equal(f.transfers(), 1);
});

test("a repeated stylesheet failure settles instead of waiting for the global deadline", async () => {
  const f = fixture({ retry: "error" });
  await assert.rejects(promptly(f.assets.styles(f.document), f.controller), /asset-unavailable/);
  assert.equal(f.transfers(), 1);
});

test("an already loaded stylesheet is reused without another transfer", async () => {
  const f = fixture({ sheet: {} });
  await promptly(f.assets.styles(f.document), f.controller);
  assert.equal(f.transfers(), 0);
});

test("concurrent page preparation shares one retry of the same stylesheet", async () => {
  const f = fixture();
  await promptly(Promise.all([f.assets.styles(f.document), f.assets.styles(f.document)]), f.controller);
  assert.equal(f.transfers(), 1);
});

test("abort rejects a pending stylesheet retry", async () => {
  const f = fixture({ retry: "pending" });
  const pending = f.assets.styles(f.document);
  f.controller.abort();
  await assert.rejects(promptly(pending, f.controller), /asset-unavailable/);
});

test("a fast stylesheet failure remains observable when page preparation consumes it later", async () => {
  const f = fixture({ retry: "error" });
  // HTML requests can still be in flight while the shared stylesheet settles.
  // The loader must retain the failure without an unhandled rejection event.
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(promptly(f.assets.styles(f.document), f.controller), /asset-unavailable/);
});

test("preparation cancelled before consumption does not start a stylesheet retry", async () => {
  const f = fixture({ retry: "pending" });
  f.controller.abort();
  await assert.rejects(promptly(f.assets.styles(f.document), f.controller));
  assert.equal(f.transfers(), 0);
});
