import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { currentAssets, assetInventory, recordAssetRelease } from "../assets-lifecycle.mjs";

test("asset inventory protects current, rollback and unknown assets without modifying them", () => {
  const root = mkdtempSync(resolve(tmpdir(), "blackbox-assets-"));
  mkdirSync(resolve(root, "public/assets"), { recursive: true });
  mkdirSync(resolve(root, "src/generated"), { recursive: true });
  const add = (name) => {
    const sha256 = createHash("sha256").update(name).digest("hex");
    const url = `/assets/${name}.${sha256.slice(0, 16)}.js`;
    writeFileSync(resolve(root, "public" + url), name);
    return { url, sha256, bytes: name.length };
  };
  const [current, recent, rollback, old, unknown, held] = [
    "current",
    "recent",
    "rollback",
    "old",
    "unknown",
    "held",
  ].map(add);
  writeFileSync(
    resolve(root, "src/generated/assets.ts"),
    "export const assets: Record<string,string> = " + JSON.stringify({ "/app.js": current.url }) + ";\n",
  );
  recordAssetRelease(root, [old], new Date("2025-01-01"));
  recordAssetRelease(root, [rollback], new Date("2025-02-01"));
  recordAssetRelease(root, [recent], new Date("2026-11-08"));
  const heldPath = recordAssetRelease(root, [held], new Date("2024-01-01"));
  const heldRecord = JSON.parse(readFileSync(heldPath, "utf8"));
  heldRecord.keep = true;
  writeFileSync(heldPath, JSON.stringify(heldRecord));
  const snapshot = () =>
    readdirSync(resolve(root, "public/assets")).map((name) => [
      name,
      readFileSync(resolve(root, "public/assets", name), "utf8"),
    ]);
  const before = snapshot();
  assert.deepEqual(currentAssets(root), [current]);
  const report = assetInventory(root, { now: new Date("2026-11-09") });
  const status = (asset) => report.files.find((file) => file.url === asset.url).status;
  assert.equal(status(current), "current");
  assert.equal(status(recent), "protected-release");
  assert.equal(status(rollback), "protected-release");
  assert.equal(status(held), "protected-release");
  assert.equal(status(old), "review-candidate");
  assert.equal(status(unknown), "untracked-keep");
  assert.deepEqual(snapshot(), before);
  writeFileSync(resolve(root, "public" + current.url), "corrupt");
  assert.throws(() => currentAssets(root), /hash mismatch/);
});
