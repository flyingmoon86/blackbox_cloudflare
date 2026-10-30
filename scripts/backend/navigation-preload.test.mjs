import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// DOM/history/network coverage runs in Chromium: check-local-navigation.mjs.
function staticWorker({ blocked = false, privateResponse = false } = {}) {
  const listeners = new Map(),
    stored = new Map();
  let requests = 0;
  const cache = {
    match: async (r) => stored.get(r.url)?.clone(),
    put: async (r, value) => stored.set(r.url, value),
    keys: async () => [...stored.keys()].map((url) => new Request(url)),
    delete: async (r) => stored.delete(r.url),
  };
  vm.runInNewContext(readFileSync("public/navigation-worker.js", "utf8"), {
    self: {
      location: new URL("https://blackbox.test"),
      addEventListener: (event, callback) => listeners.set(event, callback),
    },
    URL,
    caches: {
      open: async () => {
        if (blocked) throw Error("denied");
        return cache;
      },
    },
    fetch: async () => {
      requests++;
      return new Response("static bytes", {
        headers: { "Cache-Control": privateResponse ? "private, no-store" : "public, max-age=31536000, immutable" },
      });
    },
  });
  return {
    stored,
    get requests() {
      return requests;
    },
    async request(path, options) {
      let result;
      listeners.get("fetch")({
        request: new Request("https://blackbox.test" + path, options),
        respondWith: (promise) => (result = promise),
      });
      return result;
    },
  };
}
test("static cache serves hashed assets locally, never intercepts documents or private HTTP variants", async () => {
  const fixture = staticWorker();
  const asset = "/assets/app.0123456789abcdef.js";
  assert.equal(await (await fixture.request(asset)).text(), "static bytes");
  assert.equal(await (await fixture.request(asset)).text(), "static bytes");
  assert.equal(fixture.requests, 1);
  for (const path of [
    "/",
    "/members",
    "/graduation/1",
    "/member-photos/1/file",
    "/resources/1/preview",
    "/resources/1/download",
    "/site/theme.css",
    "/admin/notifications",
    "/assets/app.js",
    asset + "?user=1",
  ]) {
    for (const options of [
      {},
      { method: "HEAD" },
      { headers: { Range: "bytes=0-9" } },
      { headers: { "If-None-Match": "fixture" } },
    ])
      assert.equal(await fixture.request(path, options), undefined, path);
  }
  assert.equal(await fixture.request(asset, { headers: { Authorization: "Bearer fixture" } }), undefined);
  assert.equal(await fixture.request(asset, { headers: { Range: "bytes=0-9" } }), undefined);
  assert.equal(fixture.stored.size, 1);
});
test("storage failure falls back to network; private/no-store responses never persist", async () => {
  const asset = "/assets/app.0123456789abcdef.js";
  for (const options of [{ blocked: true }, { privateResponse: true }]) {
    const fixture = staticWorker(options);
    await fixture.request(asset);
    await fixture.request(asset);
    assert.equal(fixture.requests, 2);
    assert.equal(fixture.stored.size, 0);
  }
});
test("page lifecycle aborts global listeners and observers before reinitializing", () => {
  const window = {},
    document = new EventTarget(),
    target = new EventTarget();
  document.readyState = "complete";
  document.querySelector = () => ({});
  vm.runInNewContext(readFileSync("public/page-runtime.js", "utf8"), { window, document, AbortController });
  let calls = 0,
    disconnected = 0;
  window.blackboxPages.register("example", (_, scope) => {
    scope.listen(target, "change", () => calls++);
    scope.observe(
      {
        observe() {},
        disconnect() {
          disconnected++;
        },
      },
      {},
    );
  });
  target.dispatchEvent(new Event("change"));
  window.blackboxPages.unmount();
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 1);
  window.blackboxPages.mount({});
  target.dispatchEvent(new Event("change"));
  assert.equal(calls, 2);
  window.blackboxPages.unmount();
  assert.equal(disconnected, 2);
});
class ScriptElement extends EventTarget {}
function boot(entered = false) {
  const window = new EventTarget(),
    document = new EventTarget();
  const data = new Map(entered ? [["blackbox-site-entered:v1", "entered"]] : []);
  const timers = new Map();
  document.readyState = "loading";
  document.referrer = "";
  document.documentElement = {};
  document.currentScript = { dataset: { siteOpening: "test" }, hasAttribute: () => true };
  vm.runInNewContext(readFileSync("public/curtain-boot.js", "utf8"), {
    window,
    document,
    URL,
    Date,
    CustomEvent,
    HTMLScriptElement: ScriptElement,
    location: new URL("https://blackbox.test/"),
    navigator: { onLine: true },
    performance: { getEntriesByType: () => [] },
    matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    sessionStorage: {
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
    setTimeout: (fn, ms) => {
      timers.set(ms, fn);
      return ms;
    },
    clearTimeout: (id) => timers.delete(id),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  return { window, document, timers };
}
test("curtain tracks actual failures and timeout releases it without a skip entrance", () => {
  const fixture = boot();
  const opening = fixture.window.blackboxSiteOpening;
  opening.update({ completed: 2, total: 8, failed: 3 });
  assert.equal(opening.failed, 3);
  assert.equal(opening.completed, 2);
  fixture.timers.get(65000)();
  assert.equal(opening.status, "timeout");
  assert.equal(opening.active, false);
  assert.equal(
    boot(true).window.blackboxSiteOpening.active,
    true,
    "an old entered marker cannot skip a fresh document's preparation",
  );
});
test("optional external script failures do not cancel preparation; own script failures still release it", () => {
  const fixture = boot();
  const fail = (src) => {
    const script = new ScriptElement();
    script.src = src;
    const event = new Event("error");
    Object.defineProperty(event, "target", { value: script });
    fixture.window.dispatchEvent(event);
  };
  fail("https://static.cloudflareinsights.com/beacon.min.js");
  assert.equal(fixture.window.blackboxSiteOpening.active, true);
  fail("https://blackbox.test/assets/page-runtime.0123456789abcdef.js");
  assert.equal(fixture.window.blackboxSiteOpening.active, false);
  assert.equal(fixture.window.blackboxSiteOpening.status, "partial");
});
