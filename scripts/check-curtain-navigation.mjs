// Real Worker fixtures verify first-entry only curtains and native internal links.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const args = [
  resolve("scripts/check-loading-performance.mjs"),
  "--mode=navigation",
  "--output=" + resolve(process.env.EVIDENCE_DIR || "artifacts/working/native-navigation/navigation"),
];
if (process.env.PLAYWRIGHT_MODULE)
  args.push(
    "--playwright=" +
      (process.env.PLAYWRIGHT_MODULE.startsWith("file:")
        ? fileURLToPath(process.env.PLAYWRIGHT_MODULE)
        : process.env.PLAYWRIGHT_MODULE),
  );
const result = spawnSync(process.execPath, args, { stdio: "inherit", env: process.env });
if (result.error) throw result.error;
process.exit(result.status || 0);
