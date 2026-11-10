import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assetInventory } from "./assets-lifecycle.mjs";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--output"))
  throw new Error("Usage: npm run assets:audit -- [--output report.json]");
const report = assetInventory(process.cwd());
if (args.length) writeFileSync(resolve(args[1]), JSON.stringify(report, null, 2) + "\n");
else console.log(JSON.stringify(report, null, 2));
console.error("Asset inventory (no deletions):", report.counts);
