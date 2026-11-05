import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { measureUploadScenario } from "./backend/upload-performance-fixture.mjs";
const out = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-05-upload-backend/costs");
mkdirSync(out, { recursive: true });
const report = {
  date: new Date().toISOString(),
  scope:
    "Synthetic in-memory D1 and R2; actual Worker; warm capacity ledger, 2000 legacy resources per scenario. Binding call counts, not production time or billing.",
  sourceHashes: Object.fromEntries(
    ["src/routes/uploads.ts", "src/services/uploads.ts", "src/services/upload-policy.ts"].map((p) => [
      p,
      createHash("sha256").update(readFileSync(p)).digest("hex"),
    ]),
  ),
  scenarios: [],
};
for (const user of [1, 2])
  for (const type of ["photo", "script", "audio", "other"])
    report.scenarios.push(await measureUploadScenario(type, user));
writeFileSync(resolve(out, "upload-costs.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
