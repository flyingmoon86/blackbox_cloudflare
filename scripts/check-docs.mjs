import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowed = new Set(["README.md", "开发维护.md", "发布与恢复.md", "handbooks"]);
for (const entry of readdirSync(resolve(root, "docs")))
  assert.ok(allowed.has(entry), `Unexpected docs entry: ${entry}; use an existing guide or artifacts/task`);
for (const name of ["output", "outputs"])
  assert.ok(!existsSync(resolve(root, name)), `Retired output directory: ${name}`);
const files = ["README.md", "AGENTS.md", "docs/README.md", "docs/开发维护.md", "docs/发布与恢复.md"];
let links = 0;
for (const file of files) {
  const text = readFileSync(resolve(root, file), "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^\n)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    assert.ok(existsSync(resolve(dirname(resolve(root, file)), target)), `${file}: missing ${target}`);
    links++;
  }
}
// Browser evidence must never be emitted into maintained documentation.
for (const entry of readdirSync(resolve(root, "scripts"))) {
  if (!entry.endsWith(".mjs") || entry === "check-docs.mjs") continue;
  const text = readFileSync(resolve(root, "scripts", entry), "utf8");
  assert.ok(!/["'`]docs\/evidence\//.test(text), `${entry}: evidence must go to artifacts/`);
}
console.log(`Documentation policy and ${links} local links passed`);
