import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync("public/home-light.js", "utf8");
function fixture({ preview = false, failedBase = false, failedLight = false, mismatch = false, mobile = false } = {}) {
  const handlers = {};
  const element = (props = {}) => ({
    style: {
      setProperty(k, v) {
        this[k] = v;
      },
    },
    dataset: {},
    attrs: {},
    events: {},
    hidden: false,
    addEventListener(k, f) {
      this.events[k] = f;
    },
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    getAttribute(k) {
      return this.attrs[k] ?? null;
    },
    ...props,
  });
  const base = element({
    complete: true,
    naturalWidth: failedBase ? 0 : 1672,
    naturalHeight: failedBase ? 0 : 941,
    width: 1672,
    height: 941,
  });
  const light = element({
    complete: true,
    naturalWidth: failedLight ? 0 : mismatch ? 1668 : 1672,
    naturalHeight: failedLight ? 0 : 941,
  });
  const toggle = element({ disabled: true }),
    status = element({ textContent: "" }),
    art = element({ clientWidth: mobile ? 390 : 1280, clientHeight: mobile ? 788 : 664 }),
    plane = element();
  const config = { intensity: 85, shade: 58, desktopX: 50, desktopY: 45, mobileX: 64, mobileY: 40 };
  const nodes = {
    "[data-theatre-base]": base,
    "[data-theatre-light]": light,
    ".theatre-light-switch": toggle,
    ".theatre-light-status": status,
    ".theatre-art": art,
    ".stage-image-plane": plane,
  };
  const scene = element({
    dataset: { theatreScene: "productions", stageConfig: JSON.stringify(config) },
    querySelector: (s) => nodes[s],
    hasAttribute: () => preview,
  });
  const storage = new Map([["blackbox-stage-lights", "on"]]);
  const parent = { postMessage() {} };
  vm.runInNewContext(source, {
    document: { querySelector: () => scene, documentElement: { classList: { add() {} } }, addEventListener() {} },
    window: {
      addEventListener(k, f) {
        handlers[k] = f;
      },
    },
    parent,
    location: { origin: "http://localhost", href: "http://localhost/productions" },
    localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    matchMedia: () => ({ matches: mobile }),
    ResizeObserver: class {
      observe() {}
    },
    URL,
  });
  return { base, light, toggle, status, plane, scene, storage, handlers, parent, config };
}
test("shared switch persists state, synchronizes storage and uses one responsive crop for all layers", () => {
  for (const mobile of [false, true]) {
    const f = fixture({ mobile });
    assert.equal(f.scene.dataset.lights, "on");
    assert.equal(f.toggle.disabled, false);
    assert.equal(f.toggle.attrs["aria-pressed"], "true");
    const width = parseFloat(f.plane.style.width),
      height = parseFloat(f.plane.style.height);
    assert.ok(width >= (mobile ? 390 : 1280));
    assert.ok(height >= (mobile ? 788 : 664));
    assert.ok(Math.abs(width / height - 1672 / 941) < 0.00001);
    f.toggle.events.click();
    assert.equal(f.storage.get("blackbox-stage-lights"), "off");
    f.storage.set("blackbox-stage-lights", "on");
    f.handlers.storage({ key: "blackbox-stage-lights" });
    assert.equal(f.scene.dataset.lights, "on");
  }
});
test("image failure and mismatched dimensions keep light off and disable control", () => {
  for (const options of [{ failedBase: true }, { failedLight: true }, { mismatch: true }]) {
    const f = fixture(options);
    assert.equal(f.scene.dataset.lights, "off");
    assert.equal(f.toggle.disabled, true);
    assert.equal(f.light.hidden, true);
    assert.ok(f.status.textContent);
    f.handlers.storage({ key: "blackbox-stage-lights" });
    assert.equal(f.scene.dataset.lights, "off");
    if (options.failedLight || options.mismatch) assert.equal(f.base.hidden, false);
  }
});
test("admin preview is isolated from visitor preference and ignores foreign messages", () => {
  const f = fixture({ preview: true });
  assert.equal(f.scene.dataset.lights, "off");
  f.toggle.events.click();
  f.toggle.events.click();
  assert.equal(f.storage.get("blackbox-stage-lights"), "on");
  const data = {
    type: "stage-preview",
    scene: "productions",
    config: { ...f.config, intensity: 40, direction: false },
    on: true,
  };
  f.handlers.message({ origin: "https://wrong.example", source: f.parent, data });
  assert.equal(f.scene.dataset.lights, "off");
  f.handlers.message({ origin: "http://localhost", source: f.parent, data });
  assert.equal(f.scene.dataset.lights, "on");
  assert.equal(f.scene.dataset.direction, "off");
  assert.equal(f.scene.style["--stage-intensity"], 0.4);
});
test("reduced motion disables all light transitions and artwork remains outside homepage scenes", () => {
  const css = readFileSync("public/home-light.css", "utf8");
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)[\s\S]*stage-direction[\s\S]*transition:none/);
  const home = readFileSync("src/views/home.ts", "utf8");
  assert.match(home, /<h1>黑匣子<\/h1>/);
  assert.doesNotMatch(home, /永远是你家/);
  assert.match(home, /stageAttributes\("home"[\s\S]*\+\s+image[\s\S]*id="welcome"/);
  assert.doesNotMatch(readFileSync("src/views/stage-art.ts", "utf8"), /stage-lamp-label/);
});

test("story text and poster have independent flowing columns with uncropped poster preview", () => {
  const home = readFileSync("src/views/home.ts", "utf8");
  const css = readFileSync("public/home-light.css", "utf8");
  assert.match(home, /troupe-narrative[\s\S]*troupe-recruitment[\s\S]*<aside class="troupe-poster"/);
  assert.doesNotMatch(home, /class="about-columns"/);
  assert.match(css, /#about \.about-copy:has\(\.recruitment-poster\)[^}]*padding:0/);
  assert.match(css, /#about \.recruitment-poster figcaption\{position:static/);
  assert.match(css, /\.poster-zoom:not\(\.is-zoomed\) img\{[^}]*max-height:65dvh/);
  assert.match(css, /@media\(max-width:900px\)[\s\S]*\.troupe-layout\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.stage-direction\{z-index:2\}/);
  assert.match(css, /\.theatre-art::after\{[^}]*z-index:1/);
});
