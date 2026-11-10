import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

function runtime() {
  const window = {};
  const document = { readyState: "complete", querySelector: () => ({}) };
  const errors = [];
  vm.runInNewContext(readFileSync("public/page-runtime.js", "utf8"), {
    window,
    document,
    AbortController,
    console: { error: (...args) => errors.push(args) },
  });
  return { pages: window.blackboxPages, errors };
}

test("failed initialization releases listeners and observers without blocking other features", () => {
  const { pages, errors } = runtime();
  const target = new EventTarget();
  let events = 0,
    disconnected = 0,
    healthy = 0;
  pages.register("broken", (_, scope) => {
    scope.listen(target, "probe", () => events++);
    scope.observe(
      {
        observe() {},
        disconnect() {
          disconnected++;
        },
      },
      {},
    );
    throw Error("private error detail must not be logged");
  });
  pages.register("healthy", () => healthy++);
  target.dispatchEvent(new Event("probe"));
  assert.equal(events, 0);
  assert.equal(disconnected, 1);
  pages.unmount();
  pages.mount({});
  assert.equal(healthy, 2);
  assert.equal(disconnected, 2);
  assert.equal(errors.length, 2);
  assert.equal(errors[0][1].feature, "broken");
  assert.doesNotMatch(JSON.stringify(errors), /private error detail/);
});

test("throwing cleanup cannot block later cleanup; unmount is idempotent and remount works", () => {
  const { pages, errors } = runtime();
  const calls = [];
  pages.register("first", (_, scope) => {
    scope.dispose(() => calls.push("first released"));
    scope.dispose(() => {
      throw Error("cleanup failure");
    });
  });
  pages.register("second", (_, scope) => scope.dispose(() => calls.push("second released")));
  pages.unmount();
  pages.unmount();
  assert.deepEqual(calls, ["first released", "second released"]);
  assert.equal(errors.length, 1);
  pages.mount({}, "push");
  pages.unmount();
  assert.equal(calls.length, 4);
});

test("late disposals release immediately and failed feature replacement leaves one active listener", () => {
  const { pages } = runtime();
  const target = new EventTarget();
  let oldScope,
    released = 0,
    events = 0;
  pages.register("replace", (_, scope) => {
    oldScope = scope;
    scope.listen(target, "probe", () => events++);
  });
  pages.register("replace", () => {
    throw Error("failed replacement");
  });
  oldScope.dispose(() => released++);
  oldScope.observe(
    {
      observe() {
        throw Error("must not observe after unmount");
      },
    },
    {},
  );
  target.dispatchEvent(new Event("probe"));
  assert.equal(events, 0);
  assert.equal(released, 1);
  pages.register("replace", (_, scope) => scope.listen(target, "probe", () => events++));
  target.dispatchEvent(new Event("probe"));
  assert.equal(events, 1);
});
