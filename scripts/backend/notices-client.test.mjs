import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const code = app.slice(app.indexOf("const announcementUpdate ="), app.indexOf("for (const video"));
const notificationCode = app.slice(app.indexOf("const notificationHost ="), app.indexOf("const announcementUpdate ="));
class Element extends EventTarget {
  hidden = true;
}
class Dialog extends EventTarget {
  open = true;
}
function mount(storage, revision = "r1", user = "guest", dialog = null) {
  const alert = new Element(),
    read = new Element(),
    dismiss = new Element();
  alert.dataset = { announcementUpdate: revision, announcementUser: user };
  alert.querySelector = (selector) => (selector.includes("-read") ? read : dismiss);
  runInNewContext(code, {
    document: { querySelector: () => alert },
    notice: dialog,
    HTMLDialogElement: Dialog,
    localStorage: storage,
  });
  return { alert, read, dismiss };
}
test("announcement acknowledgment persists per user and returns for changed content", () => {
  const data = new Map();
  const storage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
  const first = mount(storage);
  assert.equal(first.alert.hidden, false);
  first.dismiss.dispatchEvent(new Event("click"));
  assert.equal(first.alert.hidden, true);
  assert.equal(mount(storage).alert.hidden, true);
  const updated = mount(storage, "r2");
  assert.equal(updated.alert.hidden, false);
  updated.read.dispatchEvent(new Event("click"));
  assert.equal(mount(storage, "r2").alert.hidden, true);
  assert.equal(mount(storage, "r2", "2").alert.hidden, false);
});
test("announcement waits for test notice and tolerates unavailable storage", () => {
  const storage = {
    getItem() {
      throw Error("denied");
    },
    setItem() {
      throw Error("denied");
    },
  };
  const dialog = new Dialog();
  const page = mount(storage, "r1", "guest", dialog);
  assert.equal(page.alert.hidden, true);
  dialog.open = false;
  dialog.dispatchEvent(new Event("close"));
  assert.equal(page.alert.hidden, false);
  page.dismiss.dispatchEvent(new Event("click"));
  assert.equal(page.alert.hidden, true);
});

class NotificationElement extends EventTarget {
  constructor(tag = "div") {
    super();
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.textContent = "";
  }
  append(...children) {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  querySelector(selector) {
    if (selector === "[data-notification-status]")
      return this.children.find((child) => child.dataset?.notificationStatus) || null;
    return null;
  }
  get childElementCount() {
    return this.children.length;
  }
}
class NotificationAnchor extends NotificationElement {}

async function notificationFailure(response, withPreviousCount = false) {
  const host = new NotificationElement();
  if (withPreviousCount) {
    const previous = new NotificationAnchor("a");
    previous.textContent = "3 项待办";
    host.append(previous);
  }
  const warnings = [];
  const document = {
    hidden: false,
    querySelector: (selector) => (selector === "[data-admin-notifications]" ? host : null),
    createElement: (tag) => (tag === "a" ? new NotificationAnchor(tag) : new NotificationElement(tag)),
    addEventListener() {},
  };
  runInNewContext(notificationCode, {
    AbortSignal,
    Error,
    HTMLAnchorElement: NotificationAnchor,
    URLSearchParams,
    clearTimeout() {},
    console: { warn: (...args) => warnings.push(args) },
    document,
    fetch: async () => response,
    location: { assign() {} },
    setTimeout: () => 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { host, status: host.querySelector("[data-notification-status]"), warnings };
}

test("notification polling exposes expired sessions instead of swallowing a login-page redirect", async () => {
  const page = await notificationFailure(
    new Response(JSON.stringify({ error: "登录状态已失效" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
  assert.equal(page.status.dataset.notificationStatus, "auth");
  assert.equal(page.status.children[0].textContent, "登录状态已失效");
  assert.equal(page.status.children[1].textContent, "重新登录");
  assert.equal(page.status.children[1].href, "/login?next=/admin");
  assert.equal(page.warnings.length, 1);
});

test("notification polling shows an HTTP failure with a manual retry", async () => {
  const page = await notificationFailure(
    new Response(JSON.stringify({ error: "服务暂时不可用" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    }),
    true,
  );
  assert.equal(page.host.children[0].textContent, "3 项待办");
  assert.equal(page.status.dataset.notificationStatus, "request");
  assert.equal(page.status.children[0].textContent, "待办同步失败（HTTP 503）");
  assert.equal(page.status.children[1].textContent, "重试");
  assert.equal(page.warnings.length, 1);
});
