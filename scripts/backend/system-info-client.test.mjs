import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const code = readFileSync("public/system-info.js", "utf8");
test("panel loading, permission loss, failure and partial results clear stale data and allow retry", async () => {
  for (const outcome of ["ok", "partial", "401", "403", "500", "network"]) {
    let resolve, reject, reload;
    const response = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const root = {
      innerHTML: "old-private-data",
      replaceChildren() {
        this.innerHTML = "";
      },
      setAttribute(k, v) {
        this[k] = v;
      },
      querySelector() {
        return this.innerHTML.includes('role="alert"');
      },
    };
    const status = { textContent: "" };
    const refresh = {
      disabled: false,
      addEventListener(_, fn) {
        reload = fn;
      },
    };
    runInNewContext(code, {
      location: { pathname: "/admin/system/database", hash: "" },
      document: {
        querySelector: (s) => ({ "#system-live": root, "#system-status": status, "#system-refresh": refresh })[s],
      },
      fetch: () => response,
      AbortSignal,
    });
    assert.equal(root.innerHTML, "");
    assert.equal(root["aria-busy"], "true");
    assert.equal(refresh.disabled, true);
    assert.match(status.textContent, /正在加载/);
    if (outcome === "network") reject(Error());
    else
      resolve(
        new Response(outcome === "partial" ? '<p role="alert">数据库结构查询失败</p>' : "safe-data", {
          status: Number(outcome) || 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
    await new Promise((r) => setImmediate(r));
    assert.equal(root["aria-busy"], "false");
    assert.equal(refresh.disabled, false);
    assert.equal(typeof reload, "function");
    assert.match(
      status.textContent,
      outcome === "ok"
        ? /已更新/
        : outcome === "partial"
          ? /部分查询失败/
          : ["401", "403"].includes(outcome)
            ? /没有管理员权限/
            : /查询失败/,
    );
    if (!["ok", "partial"].includes(outcome)) assert.equal(root.innerHTML, "");
  }
});
