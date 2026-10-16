import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../public/navigation-preload.js", import.meta.url), "utf8");
const bootSource = await readFile(new URL("../../public/curtain-boot.js", import.meta.url), "utf8");
const origin = "https://blackbox.test";

// Small inert document for the real browser script. It neither evaluates HTML
// nor starts requests itself, so all requests below come from the preloader.
class Events {
  listeners = new Map();
  addEventListener(type, listener, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ listener, once: Boolean(options.once) });
    this.listeners.set(type, entries);
  }
  removeEventListener(type, listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter((entry) => entry.listener !== listener),
    );
  }
  dispatchEvent(event) {
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      entry.listener(event);
      if (entry.once) this.removeEventListener(event.type, entry.listener);
    }
  }
}

const attributeName = (key) => "data-" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
class Node extends Events {
  constructor(tag = "", attributes = {}, onMutation = () => {}) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.onMutation = onMutation;
    this.dataset = new Proxy({}, { get: (_, key) => attributes[attributeName(key)] });
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  remove() {}
  hasAttribute(name) {
    return name in this.attributes;
  }
  get href() {
    return this.attributes.href ? new URL(this.attributes.href, origin).href : undefined;
  }
  get src() {
    return this.attributes.src ? new URL(this.attributes.src, origin).href : undefined;
  }
  get rel() {
    return this.attributes.rel || "";
  }
  get target() {
    return this.attributes.target || "";
  }
  get loading() {
    return this.attributes.loading || "";
  }
  get parentElement() {
    return this.parent || null;
  }
  set loading(value) {
    this.attributes.loading = value;
    this.onWarm?.();
  }
  matches(selector) {
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && this.tagName !== tag.toUpperCase()) return false;
    for (const match of selector.matchAll(/\[([\w-]+)(?:([*^$]?=)["']?([^\]"']*)["']?)?\]/g)) {
      const [, name, operator, value] = match;
      const actual = this.getAttribute(name);
      if (actual === null) return false;
      if (operator === "=" && actual !== value) return false;
      if (operator === "^=" && !actual.startsWith(value)) return false;
      if (operator === "$=" && !actual.endsWith(value)) return false;
      if (operator === "*=" && !actual.includes(value)) return false;
    }
    for (const match of selector.replace(/\[[^\]]*\]/g, "").matchAll(/\.([\w-]+)/g)) {
      if (!(this.attributes.class || "").split(/\s+/).includes(match[1])) return false;
    }
    return true;
  }
  closest(selector) {
    for (let candidate = this; candidate; candidate = candidate.parent) {
      for (const option of selector.split(",")) {
        const parts = option.trim().split(/\s+/);
        if (!candidate.matches(parts.pop())) continue;
        let ancestor = candidate.parent;
        while (parts.length && ancestor) {
          if (ancestor.matches(parts.at(-1))) parts.pop();
          ancestor = ancestor.parent;
        }
        if (!parts.length) return candidate;
      }
    }
    return null;
  }
  querySelectorAll(selector) {
    const options = selector.split(",").map((value) => value.trim());
    return this.children.filter((child) => options.some((value) => child.matches(value)));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  append(...nodes) {
    this.onMutation({ type: "append", parent: this.tagName, nodes });
  }
  set innerHTML(value) {
    if (this.tagName !== "TEMPLATE") this.onMutation({ type: "html", parent: this.tagName, value });
    const target = this.content || this;
    let picture;
    target.children = [];
    for (const match of value.matchAll(/<(\/?)(link|script|img|source|picture)\b([^>]*)>/gi)) {
      if (match[1]) {
        if (match[2] === "picture") picture = null;
        continue;
      }
      const attributes = Object.fromEntries(
        [...match[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map((attribute) => [
          attribute[1],
          (attribute[2] ?? attribute[3] ?? attribute[4] ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"'),
        ]),
      );
      const node = new Node(match[2], attributes);
      if (picture) {
        node.parent = picture;
        picture.children.push(node);
      }
      if (match[2] === "picture") picture = node;
      target.children.push(node);
    }
  }
}

const markup = (extra = "") =>
  `<link rel="stylesheet" href="/assets/shared.0123456789abcdef.css"><script src="/assets/site.0123456789abcdef.js" defer></script>
  <img data-theatre-base src="/resources/1/preview" loading="eager">${extra}`;

function browser({
  cacheVariant = "public-v1",
  preloadVariant = "public",
  html = markup(),
  publicHtml = markup(),
  responses = new Map(),
  imageResults = new Map(),
  storageEntries = [],
  openingState = {},
  readyState = "complete",
  scriptSource = source,
  siteOpeningVersion,
  curtainArrival = false,
  mobile = false,
  referrer = "",
  curtainPage = false,
} = {}) {
  const requested = [];
  const images = [];
  const mutations = [];
  const parsed = [];
  const updates = [];
  const finishes = [];
  const storage = new Map(storageEntries);
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const clock = {
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (let step = 0; step < 1000; step++) {
        await drain();
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, timer] = due[0];
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = target;
      await drain();
    },
  };
  const document = new Events();
  document.body = new Node(
    "body",
    { "data-navigation-cache": cacheVariant, "data-navigation-preload": preloadVariant },
    (item) => mutations.push(item),
  );
  document.documentElement = new Node("html", {}, (item) => mutations.push(item));
  document.head = new Node("head");
  document.readyState = readyState;
  document.referrer = referrer;
  if (siteOpeningVersion) {
    document.currentScript = new Node("script", {
      "data-site-opening": siteOpeningVersion,
      ...(curtainPage ? { "data-curtain-page": "" } : {}),
    });
    document.head.children.push(document.currentScript);
  }
  document.hidden = false;
  document.fonts = { load: async () => [], ready: Promise.resolve() };
  document.createElement = (tag) => {
    const node = new Node(tag, {}, (item) => mutations.push(item));
    if (tag === "template") {
      node.content = new Node();
      Object.defineProperty(node, "innerHTML", {
        set(value) {
          parsed.push(value);
          const inert = new Node("template");
          inert.content = node.content;
          inert.innerHTML = value;
        },
      });
    }
    return node;
  };
  document.querySelectorAll = (selector) => [
    ...document.head.querySelectorAll(selector),
    ...document.body.querySelectorAll(selector),
  ];
  document.querySelector = (selector) => document.querySelectorAll(selector)[0] || null;
  document.body.innerHTML = html;
  mutations.length = 0;
  for (const node of document.querySelectorAll("img[src]")) {
    const selected = mobile && node.parentElement?.querySelector("source[media][srcset]")?.getAttribute("srcset");
    node.currentSrc = selected ? new URL(selected, origin).href : node.src;
    node.url = node.currentSrc;
    node.complete = true;
    node.naturalWidth = 100;
    node.onWarm = () => {
      if (!images.includes(node)) images.push(node);
    };
    node.decode = () => decode(node.url);
  }
  const window = new Events();
  window.blackboxCurtainArrival = curtainArrival;
  window.innerWidth = 1366;
  window.devicePixelRatio = 1;
  if (openingState !== null)
    window.blackboxSiteOpening = {
      active: true,
      version: "test-version",
      storageKey: "blackbox-preload-test:test-version",
      update: (value) => updates.push(structuredClone(value)),
      finish: (value) => finishes.push(structuredClone(value)),
      ...openingState,
    };
  const fetch = async (url, options = {}) => {
    const href = new URL(url, origin).href;
    const entry = { url: href, options, aborted: false };
    requested.push(entry);
    const configured = responses.get(href) ?? responses.get(new URL(href).pathname);
    if (configured === "hang") {
      return new Promise((_, reject) => {
        const abort = () => {
          entry.aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        };
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    if (configured instanceof Error) throw configured;
    if (configured) return configured;
    if (new URL(href).pathname.startsWith("/assets/")) return new Response("asset", { status: 200 });
    return new Response(publicHtml, {
      headers: { "Content-Type": "text/html", "X-Blackbox-Navigation": "public-v1" },
    });
  };
  window.fetch = fetch;
  const decode = (url) => {
    const result = imageResults.get(url) ?? imageResults.get(new URL(url).pathname);
    if (result === "hang") return new Promise(() => {});
    return result instanceof Error ? Promise.reject(result) : Promise.resolve();
  };
  class Image extends Events {
    set src(value) {
      this.url = new URL(value, origin).href;
      images.push(this);
      this.complete = false;
      this.naturalWidth = 0;
      queueMicrotask(() => {
        this.complete = true;
        this.naturalWidth = 100;
        this.dispatchEvent({ type: "load" });
      });
    }
    get src() {
      return this.url;
    }
    decode() {
      return decode(this.url);
    }
    removeAttribute(name) {
      if (name === "src") this.cancelled = true;
    }
  }
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { connection: Object.assign(new Events(), { saveData: false, effectiveType: "4g" }) },
    location: new URL(origin + "/"),
    Element: Node,
    HTMLDialogElement: class extends Node {
      showModal() {}
    },
    HTMLScriptElement: class extends Node {},
    Image,
    URL,
    AbortController,
    DOMException,
    Response,
    fetch,
    sessionStorage,
    innerWidth: 1366,
    devicePixelRatio: 1,
    matchMedia: (query) => Object.assign(new Events(), { matches: mobile && query.includes("max-width") }),
    performance: { now: () => now, getEntriesByType: () => [] },
    Date: class extends Date {
      static now() {
        return 1791763200000 + now;
      }
    },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    CustomEvent: class {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    console,
  });
  window.sessionStorage = sessionStorage;
  const execute = (script) => vm.runInContext(script, context, { filename: "navigation-browser-script.js" });
  execute(scriptSource);
  return {
    window,
    document,
    navigator: context.navigator,
    requested,
    images,
    mutations,
    parsed,
    updates,
    finishes,
    storage,
    clock,
    execute,
  };
}

async function drain() {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("preloader stays on the five unfiltered public landing routes and skips unmarked private documents", async () => {
  const privatePage = browser({ cacheVariant: "none", preloadVariant: "" });
  await drain();
  assert.equal(privatePage.window.blackboxNavigationPrefetch, undefined);
  assert.equal(privatePage.requested.length, 0);

  const s = browser();
  const api = s.window.blackboxNavigationPrefetch;
  for (const path of ["/", "/productions", "/resources", "/members", "/thanks", "/members#team"]) {
    assert.equal(api.eligible(path), true, path);
  }
  const before = s.requested.length;
  for (const path of [
    "https://else.test/productions",
    "/admin",
    "/login",
    "/profile",
    "/productions/1",
    "/resources?q=1",
    "/members?page=2",
    "/thanks?x=1",
  ]) {
    assert.equal(api.eligible(path), false, path);
    assert.equal(api.prepare(path), null, path);
  }
  assert.equal(s.requested.length, before);
  api.cancel();
  await drain();

  const warm = browser({ storageEntries: [["blackbox-preload-test:test-version", "ready"]] });
  assert.equal((await warm.window.blackboxNavigationPrefetch.startupPromise).status, "warm");
  assert.equal(warm.requested.length, 0);
  assert.equal(warm.images.length, 0);
  assert.equal(warm.finishes.length, 0);

  const oldVersion = browser({ storageEntries: [["blackbox-preload-test:old-version", "ready"]] });
  assert.equal((await oldVersion.window.blackboxNavigationPrefetch.startupPromise).status, "ready");
  assert.ok(oldVersion.requested.length > 0);
});

test("signed public pages prepare anonymous HTML without warming images from the signed document", async () => {
  const s = browser({
    cacheVariant: "none",
    html: markup('<img data-theatre-light src="/resources/900/preview"><script>window.executed = true</script>'),
    publicHtml: markup('<img data-theatre-light src="/resources/2/preview">'),
  });
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "ready");
  const pages = s.requested.filter((entry) => !new URL(entry.url).pathname.startsWith("/assets/"));
  assert.deepEqual(
    new Set(pages.map((entry) => new URL(entry.url).pathname)),
    new Set(["/", "/productions", "/resources", "/members", "/thanks"]),
  );
  for (const entry of pages) assert.equal(entry.options.credentials, "omit");
  assert.equal(
    s.images.some((image) => image.url.includes("/900/")),
    false,
  );
  assert.equal(
    s.images.some((image) => image.url.includes("/2/preview") && image.complete),
    true,
  );
  assert.equal(s.window.executed, undefined);
  assert.deepEqual(s.mutations, []);
});

test("shared resources are fetched once and startup excludes gallery tails, original files and executable HTML", async () => {
  const covers = Array.from(
    { length: 40 },
    (_, index) =>
      `<img class="production-cover" src="/productions/${100 + index}/cover?size=preview&amp;v=${100 + index}">`,
  ).join("");
  const extra = `${covers}<img src="/resources/800/original"><img src="https://else.test/photo.jpg">
    <video src="/resources/801/file"></video><audio src="/resources/802/file"></audio>
    <script>window.executed = true; fetch('/private')</script><script src="/scripts/private.js"></script>`;
  const sharedDestination =
    '<link rel="stylesheet" href="/assets/destination.0123456789abcdef.css"><script src="/assets/destination.0123456789abcdef.js"></script>';
  const s = browser({ html: markup(extra), publicHtml: markup(sharedDestination + extra) });
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "ready");
  assert.equal(result.failed, 0);
  assert.equal(result.completed, result.total);
  assert.equal(s.updates.at(-1).completed, result.total);
  assert.equal(
    s.updates.every(
      (update, index) =>
        update.total <= result.total &&
        update.failed === 0 &&
        update.completed <= update.total &&
        (!index || update.total >= s.updates[index - 1].total),
    ),
    true,
  );
  assert.ok(s.updates.some((update) => update.discovering));
  assert.equal(s.updates.at(-1).discovering, false);
  assert.equal(s.window.executed, undefined);
  assert.deepEqual(s.mutations, []);
  const resources = s.requested.filter((entry) => new URL(entry.url).pathname.startsWith("/assets/"));
  assert.equal(resources.length, 2);
  for (const entry of resources) assert.equal(resources.filter((item) => item.url === entry.url).length, 1, entry.url);
  assert.equal(
    s.requested.some((entry) => /private|original|\/file|else\.test/.test(entry.url)),
    false,
  );
  assert.equal(
    s.images.some((image) => /original|\/file|else\.test/.test(image.url)),
    false,
  );
  const coversWarmed = s.images.filter((image) => new URL(image.url).pathname.includes("/cover"));
  assert.equal(coversWarmed.length, 4);
  assert.deepEqual(coversWarmed.map((image) => new URL(image.url).pathname).sort(), [
    "/productions/100/cover",
    "/productions/101/cover",
    "/productions/102/cover",
    "/productions/103/cover",
  ]);
  assert.equal(new Set(s.images.map((image) => image.url)).size, s.images.length);
  assert.equal(s.storage.size, 1);
  for (const [key, value] of s.storage) {
    assert.match(key, /test-version/);
    assert.equal(value, "ready");
    assert.doesNotMatch(key + value, /<|\/resources\/|\/productions\/|private/);
  }
});

test("responses without the anonymous HTML contract never provide assets or reusable content", async () => {
  const redirected = new Response("PRIVATE_REDIRECT", {
    headers: { "Content-Type": "text/html", "X-Blackbox-Navigation": "public-v1" },
  });
  Object.defineProperty(redirected, "redirected", { value: true });
  const s = browser({
    cacheVariant: "none",
    responses: new Map([
      ["/", new Response("PRIVATE_MISSING_HEADER", { headers: { "Content-Type": "text/html" } })],
      [
        "/productions",
        new Response("PRIVATE_JSON", {
          headers: { "Content-Type": "application/json", "X-Blackbox-Navigation": "public-v1" },
        }),
      ],
      ["/resources", redirected],
      [
        "/members",
        new Response("PRIVATE_ERROR", {
          status: 503,
          headers: { "Content-Type": "text/html", "X-Blackbox-Navigation": "public-v1" },
        }),
      ],
      [
        "/thanks",
        new Response("x".repeat(900000), {
          headers: { "Content-Type": "text/html", "X-Blackbox-Navigation": "public-v1" },
        }),
      ],
    ]),
  });
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "partial");
  assert.equal(result.failed, 5);
  assert.equal(s.parsed.length, 0);
  assert.equal(s.images.length, 0);
  assert.equal(
    s.requested.some((entry) => new URL(entry.url).pathname.startsWith("/assets/")),
    false,
  );
  assert.equal(s.storage.size, 0);
  assert.deepEqual(s.mutations, []);
});

test("discovered assets start while a later page is pending and progress keeps discovery explicit", async () => {
  const s = browser({ responses: new Map([["/thanks", "hang"]]) });
  await drain();
  assert.ok(s.requested.some((entry) => new URL(entry.url).pathname === "/thanks"));
  assert.ok(s.images.some((image) => image.url.endsWith("/resources/1/preview") && image.complete));
  assert.equal(s.finishes.length, 0);
  assert.ok(s.updates.some((update) => update.completed > 0 && update.discovering));
  assert.equal(s.storage.size, 0);
  await s.clock.advance(11000);
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "partial");
  assert.equal(result.completed + result.failed, result.total);
});

test("responsive picture discovery warms only the selected layer on the current and destination pages", async () => {
  const picture = (id) =>
    `<picture><source media="(max-width:900px)" srcset="/assets/${id}-mobile.0123456789abcdef.webp"><img data-theatre-base src="/assets/${id}-desktop.0123456789abcdef.webp"></picture>`;
  for (const mobile of [false, true]) {
    const s = browser({ html: picture("current"), publicHtml: picture("destination"), mobile });
    assert.equal((await s.window.blackboxNavigationPrefetch.startupPromise).status, "ready");
    const urls = s.images.map((image) => image.url);
    assert.equal(urls.length, 2);
    for (const id of ["current", "destination"])
      assert.ok(
        urls.some((url) => url.includes(`${id}-${mobile ? "mobile" : "desktop"}.`)),
        JSON.stringify({ mobile, id, urls }),
      );
    assert.equal(
      urls.some((url) => url.includes(mobile ? "-desktop." : "-mobile.")),
      false,
    );
  }
});

test("failed stylesheet downloads and image decodes remain failed instead of completing the loading progress", async () => {
  const failedStyle = "/assets/fail.0123456789abcdef.css";
  const s = browser({
    publicHtml: markup(`<link rel="stylesheet" href="${failedStyle}">`),
    responses: new Map([[failedStyle, new Error("synthetic asset failure")]]),
    imageResults: new Map([["/resources/1/preview", new Error("synthetic decode failure")]]),
  });
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "partial");
  assert.equal(result.failed, 2);
  assert.equal(result.completed + result.failed, result.total);
  assert.ok(result.completed < result.total);
  assert.equal(s.storage.size, 0);
  assert.equal(s.finishes.at(-1).status, "partial");
  const outcomes = await s.window.blackboxNavigationPrefetch.warmAssets({
    styles: [failedStyle],
    scripts: [],
    images: [],
  });
  assert.equal(outcomes[0].status, "rejected");
});

test("cancelled startup aborts pending work and stuck requests have a finite completion bound", async () => {
  const paths = ["/", "/productions", "/resources", "/members", "/thanks"];
  const skip = browser({ cacheVariant: "none", responses: new Map(paths.map((path) => [path, "hang"])) });
  await drain();
  assert.ok(skip.requested.length > 0);
  skip.document.dispatchEvent({ type: "blackbox:navigation-start" });
  await drain();
  const skipped = await skip.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(skipped.status, "skipped");
  assert.equal(
    skip.requested.every((entry) => entry.aborted),
    true,
  );
  assert.equal(skip.storage.size, 0);
  assert.equal(skip.images.length, 0);

  const slow = browser({ cacheVariant: "none", responses: new Map(paths.map((path) => [path, "hang"])) });
  await slow.clock.advance(11000);
  const result = await slow.window.blackboxNavigationPrefetch.startupPromise;
  assert.ok(["partial", "timeout"].includes(result.status));
  assert.ok(result.failed > 0);
  assert.equal(
    slow.requested.every((entry) => entry.aborted),
    true,
  );
  assert.equal(slow.storage.size, 0);

  const undecodable = browser({ imageResults: new Map([["/resources/1/preview", "hang"]]) });
  await undecodable.clock.advance(11000);
  const decoded = await undecodable.window.blackboxNavigationPrefetch.startupPromise;
  assert.ok(["partial", "timeout"].includes(decoded.status));
  assert.ok(decoded.failed > 0);
  assert.equal(undecodable.storage.size, 0);
});

test("a preloader arriving after failure, cancellation or timeout does not restart background work", async () => {
  for (const status of ["timeout", "skipped", "partial"]) {
    const s = browser({ openingState: { active: false, status } });
    const result = await s.window.blackboxNavigationPrefetch.startupPromise;
    assert.equal(result.status, status);
    await s.clock.advance(12000);
    assert.equal(s.requested.length, 0);
    assert.equal(s.images.length, 0);
    assert.equal(s.storage.size, 0);
    assert.equal(s.finishes.length, 0);
  }
});

test("native document arrival never restarts the full first-entry loading batch", async () => {
  const s = browser({ curtainArrival: true, openingState: null });
  const result = await s.window.blackboxNavigationPrefetch.startupPromise;
  assert.equal(result.status, "navigation");
  await s.clock.advance(12000);
  assert.equal(s.requested.length, 0);
  assert.equal(s.images.length, 0);
  assert.equal(s.window.blackboxNavigationPrefetch.eligible("/productions"), true);
});

const focusNavigation = (s, path = "/productions") => {
  const link = new Node("a", { href: path });
  link.parent = new Node("nav", { class: "top" });
  s.document.dispatchEvent({ type: "focusin", target: link });
};

test("navigation cancellation cannot be undone by a completing startup, and intent resumes after cancellation", async () => {
  const responses = new Map([
    ["/productions", "hang"],
    ["/resources", "hang"],
  ]);
  const s = browser({ responses });
  await drain();
  s.document.dispatchEvent({ type: "blackbox:navigation-start" });
  assert.equal((await s.window.blackboxNavigationPrefetch.startupPromise).status, "skipped");
  const count = s.requested.length;
  focusNavigation(s);
  await s.clock.advance(1);
  assert.equal(s.requested.length, count, "startup finally must not resume work while leaving");
  responses.clear();
  s.document.dispatchEvent({ type: "blackbox:navigation-cancel" });
  focusNavigation(s);
  await s.clock.advance(1);
  assert.ok(s.requested.length > count);
});

test("pagehide aborts intent assets and pageshow restores intent without replaying the startup batch", async () => {
  const asset = "/assets/pending.0123456789abcdef.css";
  const responses = new Map([[asset, "hang"]]);
  const s = browser({
    curtainArrival: true,
    publicHtml: markup(`<link rel="stylesheet" href="${asset}">`),
    responses,
  });
  await s.window.blackboxNavigationPrefetch.startupPromise;
  focusNavigation(s);
  await s.clock.advance(1);
  const pending = s.requested.find((entry) => new URL(entry.url).pathname === asset);
  assert.ok(pending && !pending.aborted);
  s.window.dispatchEvent({ type: "pagehide", persisted: true });
  await drain();
  assert.equal(pending.aborted, true);
  const count = s.requested.length;
  focusNavigation(s, "/members");
  await s.clock.advance(1);
  assert.equal(s.requested.length, count, "a late intent finally must not resume work");
  responses.clear();
  s.window.dispatchEvent({ type: "pageshow", persisted: true });
  assert.equal(s.requested.length, count, "restoration must not start a full-site preload");
  focusNavigation(s);
  await s.clock.advance(1);
  assert.equal(s.requested.filter((entry) => new URL(entry.url).pathname === asset).length, 2);
  assert.equal(s.finishes.length, 0);
});

test("hidden, offline and limited connections cancel speculative work and recover on the next intent", async () => {
  for (const condition of ["hidden", "offline", "limited"]) {
    const responses = new Map([["/productions", "hang"]]);
    const s = browser({ curtainArrival: true, responses });
    await s.window.blackboxNavigationPrefetch.startupPromise;
    focusNavigation(s);
    await s.clock.advance(1);
    const pending = s.requested[0];
    const setCondition = (active) => {
      if (condition === "hidden") {
        s.document.hidden = active;
        s.document.dispatchEvent({ type: "visibilitychange" });
      } else if (condition === "offline") {
        s.navigator.onLine = !active;
        s.window.dispatchEvent({ type: active ? "offline" : "online" });
      } else {
        s.navigator.connection.saveData = active;
        s.navigator.connection.dispatchEvent({ type: "change" });
      }
    };
    setCondition(true);
    await drain();
    assert.equal(pending.aborted, true, condition);
    focusNavigation(s);
    await s.clock.advance(1);
    assert.equal(s.requested.length, 1, condition);
    responses.clear();
    setCondition(false);
    focusNavigation(s);
    await s.clock.advance(1);
    assert.ok(s.requested.length > 1, condition);
  }
});

test("invalid resource URLs are ignored without aborting other public assets", async () => {
  const s = browser({
    publicHtml: markup('<link rel="stylesheet" href="http://[invalid"><img data-theatre-light src="http://[invalid">'),
  });
  assert.equal((await s.window.blackboxNavigationPrefetch.startupPromise).status, "ready");
  assert.equal(s.window.blackboxNavigationPrefetch.eligible("http://[invalid"), false);
  assert.ok(s.images.length > 0);
});

test("the actual early opening preserves all failed counts before the document is ready", () => {
  const s = browser({ scriptSource: bootSource, readyState: "loading", siteOpeningVersion: "test-boot-version" });
  const opening = s.window.blackboxSiteOpening;
  const finished = [];
  s.document.addEventListener("blackbox:opening-finished", (event) => finished.push(structuredClone(event.detail)));
  opening.update({ completed: 0, total: 5, failed: 5 });
  assert.equal(opening.completed, 0);
  assert.equal(opening.total, 5);
  assert.equal(opening.failed, 5);
  opening.finish({ status: "partial" });
  assert.equal(opening.active, false);
  assert.equal(finished.length, 1);
  assert.equal(finished[0].status, "partial");
  assert.equal(finished[0].completed, 0);
  assert.equal(finished[0].total, 5);
  assert.equal(finished[0].failed, 5);
  s.document.dispatchEvent({ type: "DOMContentLoaded" });
  assert.equal(s.mutations.filter((entry) => entry.nodes?.some((node) => node.tagName === "DIALOG")).length, 0);
  assert.equal(s.storage.size, 1);
  assert.equal(s.storage.get("blackbox-navigation-dismissed:test-boot-version"), "dismissed");
  assert.equal(s.storage.has("blackbox-navigation-ready:test-boot-version"), false);
});

test("opening curtain is skipped after entry or same-origin navigation even without prepared assets", () => {
  for (const options of [
    { storageEntries: [["blackbox-site-entered:v1", "entered"]] },
    { storageEntries: [["blackbox-navigation-ready:uncached-version", "ready"]] },
    { storageEntries: [["blackbox-navigation-dismissed:uncached-version", "dismissed"]] },
    { referrer: origin + "/productions/1" },
    { storageEntries: [["blackbox-curtain-navigation", JSON.stringify({ to: origin + "/", at: 1791763200000 })]] },
  ]) {
    const s = browser({
      ...options,
      scriptSource: bootSource,
      siteOpeningVersion: "uncached-version",
      curtainPage: true,
      openingState: null,
      readyState: "loading",
    });
    assert.equal(s.window.blackboxSiteOpening, undefined);
    assert.equal(s.window.blackboxCurtain.active, false);
    assert.equal(s.mutations.length, 0, "internal destination must never insert an arrival curtain");
  }
});

test("dismissed openings defer only that version while ordinary navigation intent remains available", async () => {
  for (const status of ["skipped", "partial"]) {
    const version = "test-dismissed-version";
    const initial = browser({
      scriptSource: bootSource,
      readyState: "loading",
      siteOpeningVersion: version,
      openingState: null,
    });
    initial.window.blackboxSiteOpening.finish({ status });
    assert.equal(initial.storage.get("blackbox-navigation-dismissed:" + version), "dismissed");
    assert.equal(initial.storage.has("blackbox-navigation-ready:" + version), false);

    const next = browser({
      scriptSource: bootSource,
      readyState: "loading",
      siteOpeningVersion: version,
      openingState: null,
      storageEntries: [...initial.storage],
    });
    assert.equal(next.window.blackboxSiteOpening, undefined);
    next.execute(source);
    const api = next.window.blackboxNavigationPrefetch;
    assert.equal((await api.startupPromise).status, "deferred");
    await next.clock.advance(12000);
    assert.equal(next.requested.length, 0);
    assert.equal(next.images.length, 0);
    assert.equal(next.mutations.length, 0);
    assert.equal(api.eligible("/productions"), true);
    const navigation = new Node("nav", { class: "top" });
    const link = new Node("a", { href: "/productions" });
    link.parent = navigation;
    next.document.dispatchEvent({ type: "focusin", target: link });
    await next.clock.advance(1);
    assert.equal(next.requested.filter((entry) => new URL(entry.url).pathname === "/productions").length, 1);
    assert.equal(next.storage.has("blackbox-navigation-ready:" + version), false);

    const newerVersion = version + "-next";
    const newer = browser({
      scriptSource: bootSource,
      readyState: "loading",
      siteOpeningVersion: newerVersion,
      openingState: null,
      storageEntries: [...initial.storage],
    });
    assert.equal(newer.window.blackboxSiteOpening.active, true);
    newer.execute(source);
    assert.equal((await newer.window.blackboxNavigationPrefetch.startupPromise).status, "ready");
    assert.ok(newer.requested.length > 0);
    assert.equal(newer.storage.get("blackbox-navigation-ready:" + newerVersion), "ready");
  }
});
