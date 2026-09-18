import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
const code = app.slice(app.indexOf("const photoNavigation ="));

class FakeElement extends EventTarget {
  constructor(href = "") {
    super();
    this.href = href;
    this.hidden = true;
    this.complete = false;
    this.naturalWidth = 1;
    this.classes = new Set();
    this.classList = { add: (value) => this.classes.add(value) };
  }
}

test("photo detail arrow keys navigate without intercepting modified keys", () => {
  const previous = new FakeElement("https://blackbox.test/resources/1"),
    next = new FakeElement("https://blackbox.test/resources/3"),
    document = new FakeElement(),
    assigned = [];
  document.querySelector = (selector) =>
    selector === "[data-photo-navigation]"
      ? {
          querySelector: (linkSelector) =>
            linkSelector === "[data-photo-previous]" ? previous : linkSelector === "[data-photo-next]" ? next : null,
        }
      : null;
  document.closest = () => null;
  runInNewContext(code, {
    document,
    location: { assign: (href) => assigned.push(href) },
    HTMLImageElement: FakeElement,
  });

  const right = Object.assign(new Event("keydown", { cancelable: true }), { key: "ArrowRight" });
  document.dispatchEvent(right);
  assert.deepEqual(assigned, [next.href]);
  assert.equal(right.defaultPrevented, true);

  document.dispatchEvent(Object.assign(new Event("keydown"), { key: "ArrowLeft", ctrlKey: true }));
  assert.deepEqual(assigned, [next.href]);
});

test("photo detail exposes a recovery message when its image fails", () => {
  const document = new FakeElement(),
    media = new FakeElement(),
    preview = new FakeElement(),
    error = new FakeElement();
  media.closest = () => preview;
  document.querySelector = (selector) => {
    if (selector === "[data-photo-navigation]") return null;
    if (selector === ".resource-detail-preview>img,.resource-detail-preview>video") return media;
    if (selector === "[data-resource-media-error]") return error;
    return null;
  };
  runInNewContext(code, {
    document,
    location: { assign() {} },
    HTMLImageElement: FakeElement,
  });

  media.dispatchEvent(new Event("error"));
  assert.equal(preview.classes.has("is-unavailable"), true);
  assert.equal(error.hidden, false);
});
