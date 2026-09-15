import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const code = app.slice(app.indexOf("const announcementUpdate ="), app.indexOf("for (const video"));
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
