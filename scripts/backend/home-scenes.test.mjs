import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const code = readFileSync("public/experience.js", "utf8");
const source = code.slice(
  code.indexOf('  const stage = document.querySelector(".theatre-stage");'),
  code.indexOf('  document.querySelectorAll("[data-contribution-thanks]")'),
);
function setup(hash = "") {
  let time = 1000;
  const stage = {
    dataset: {},
    events: {},
    clientHeight: 700,
    classList: { add() {} },
    addEventListener(k, f) {
      this.events[k] = f;
    },
  };
  const scenes = ["welcome", "playbill", "about"].map((id) => ({
    id,
    hidden: false,
    inert: false,
    scrollTop: 0,
    clientHeight: 700,
    scrollHeight: 700,
    parentElement: stage,
    closest() {
      return null;
    },
    contains(node) {
      return node === this;
    },
    focus() {
      context.document.activeElement = this;
    },
  }));
  const links = scenes.map((scene) => ({
    hash: "#" + scene.id,
    attrs: {},
    events: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    addEventListener(k, f) {
      this.events[k] = f;
    },
  }));
  stage.querySelectorAll = (s) => (s === ".stage-scene" ? scenes : links);
  const events = {};
  const context = {
    document: {
      querySelector: (s) => (s === ".theatre-stage" ? stage : null),
      body: { classList: { contains: () => false } },
      addEventListener(k, f) {
        events[k] = f;
      },
    },
    window: {
      addEventListener(k, f) {
        events[k] = f;
      },
    },
    location: { hash },
    history: {
      replaceState(a, b, hash) {
        context.location.hash = hash;
      },
    },
    performance: { now: () => time },
    getComputedStyle: () => ({ overflowY: "auto" }),
    requestAnimationFrame: (f) => f(),
  };
  vm.runInNewContext(source, context);
  const visible = () => scenes.filter((s) => !s.hidden).map((s) => s.id);
  const wheel = (target = scenes.find((s) => !s.hidden), deltaY = 100) => {
    let prevented = false;
    stage.events.wheel({
      target,
      deltaY,
      deltaX: 0,
      deltaMode: 0,
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };
  return { stage, scenes, links, events, context, visible, wheel, tick: (n) => (time += n) };
}
test("homepage wheel selects one complete act and suppresses momentum skipping", () => {
  const f = setup();
  assert.deepEqual(f.visible(), ["welcome"]);
  assert.equal(f.wheel(), true);
  assert.deepEqual(f.visible(), ["playbill"]);
  f.tick(30);
  f.wheel();
  assert.deepEqual(f.visible(), ["playbill"]);
  f.tick(900);
  f.wheel();
  assert.deepEqual(f.visible(), ["about"]);
  assert.equal(f.stage.dataset.activeScene, "about");
  f.tick(900);
  f.wheel(undefined, -100);
  assert.deepEqual(f.visible(), ["playbill"]);
  assert.equal(f.scenes.filter((s) => !s.inert).length, 1);
  assert.equal(f.links[1].attrs["aria-current"], "true");
});
test("hash links and keyboard select scenes while long content remains scrollable inside its act", () => {
  const f = setup("#about");
  assert.deepEqual(f.visible(), ["about"]);
  const text = {
    closest: () => null,
    parentElement: f.scenes[2],
    scrollHeight: 1200,
    clientHeight: 400,
    scrollTop: 200,
  };
  assert.equal(f.wheel(text, -100), false);
  assert.deepEqual(f.visible(), ["about"]);
  f.links[0].events.click({ preventDefault() {} });
  assert.deepEqual(f.visible(), ["welcome"]);
  f.events.keydown({ key: "PageDown", target: f.scenes[0], preventDefault() {} });
  assert.deepEqual(f.visible(), ["playbill"]);
});
test("touch swipe changes one act; scrolling long content does not turn pages in the same gesture", () => {
  const f = setup();
  const touch = (target, start, end) => {
    f.stage.events.touchstart({ target, touches: [{ clientX: 100, clientY: start }] });
    f.stage.events.touchend({ changedTouches: [{ clientX: 100, clientY: end }] });
  };
  touch(f.scenes[0], 500, 200);
  assert.deepEqual(f.visible(), ["playbill"]);
  f.tick(900);
  f.scenes[1].scrollHeight = 1300;
  touch(f.scenes[1], 500, 200);
  assert.deepEqual(f.visible(), ["playbill"]);
});
test("scene changes transfer focus out of the hidden act; held keys do not skip acts", () => {
  const f = setup();
  f.context.document.activeElement = f.scenes[0];
  f.events.keydown({ key: "PageDown", target: f.scenes[0], preventDefault() {} });
  assert.equal(f.context.document.activeElement, f.scenes[1]);
  f.events.keydown({ key: "PageDown", repeat: true, target: f.scenes[1], preventDefault() {} });
  assert.deepEqual(f.visible(), ["playbill"]);
});
