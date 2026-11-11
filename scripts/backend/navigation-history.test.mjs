import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync("src/client/navigation/history-drafts.js", "utf8").replace("export function", "function");
function harness({ blocked = false } = {}) {
  const history = {
    state: { unrelated: "preserved" },
    replaceState(state) {
      if (blocked) throw new DOMException("History unavailable", "SecurityError");
      this.state = state;
    },
    pushState(state) {
      this.state = state;
    },
  };
  const context = vm.createContext({ history, performance: { timeOrigin: 12345 } });
  const drafts = vm.runInContext(source + "\ncreateHistoryDrafts()", context);
  const field = (type, name, value, options = {}) => ({ type, name, value, ...options });
  const form = (elements, method = "get") => ({ method, dataset: { navigationDraft: "search" }, elements });
  const root = (...forms) => ({
    querySelectorAll(selector) {
      assert.equal(selector, "form[data-navigation-draft]");
      return forms;
    },
  });
  return { history, drafts, field, form, root };
}

test("history entries keep independent drafts without changing snapshots or storing text in history", () => {
  const { history, drafts, field, form, root } = harness();
  assert.equal(history.state.unrelated, "preserved");
  const first = history.state;
  drafts.capture(root(form([field("search", "q", "first search")])), "/members");
  drafts.push("/members");
  const second = history.state;
  drafts.capture(root(form([field("search", "q", "second search")])), "/members");
  for (const [state, expected] of [
    [first, "first search"],
    [second, "second search"],
  ]) {
    history.state = state;
    const input = field("search", "q", "");
    drafts.restore(root(form([input])), "/members");
    assert.equal(input.value, expected);
    assert.equal(drafts.isCurrent(), true);
    assert.doesNotMatch(JSON.stringify(history.state), /search/);
  }
});

test("only opted-in GET filters restore; private controls and mismatched pages stay untouched", () => {
  const { drafts, field, form, root } = harness();
  const fields = () => [
    field("search", "q", ""),
    field("select-one", "year", ""),
    field("password", "password", ""),
    field("hidden", "csrf", ""),
    field("file", "file", ""),
    field("text", "disabled", "", { disabled: true }),
    field("text", "long", ""),
  ];
  const previous = fields();
  previous.forEach((field) => {
    field.value = field.name === "long" ? "x".repeat(4097) : "draft";
  });
  drafts.capture(root(form(previous), form([field("text", "private", "private draft")], "post")), "/members");
  const restored = fields();
  const privateField = field("text", "private", "");
  drafts.restore(root(form(restored), form([privateField], "post")), "/members");
  assert.deepEqual(
    restored.map((field) => field.value),
    ["draft", "draft", "", "", "", "", ""],
  );
  assert.equal(privateField.value, "");
  const otherPage = fields();
  drafts.restore(root(form(otherPage)), "/resources");
  assert.ok(otherPage.every((field) => field.value === ""));
  drafts.clear();
  const cleared = fields();
  drafts.restore(root(form(cleared)), "/members");
  assert.ok(cleared.every((field) => field.value === ""));
});

test("history tagging failure cannot prevent the router from initializing", () => {
  assert.doesNotThrow(() => harness({ blocked: true }));
});
