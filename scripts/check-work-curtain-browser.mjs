// Current aggregate entry point. The former live /productions/991008 fixture,
// XHR percentage, sound and skip-button checks belonged to the removed loader.
// Both replacements create temporary synthetic HTTP fixtures; BASE_URL is unused.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const directory = resolve(process.env.EVIDENCE_DIR || "artifacts/working/native-navigation");
for (const [script, folder] of [
  ["check-curtain-first-paint.mjs", "first-paint"],
  ["check-curtain-navigation.mjs", "navigation"],
]) {
  const result = spawnSync(process.execPath, [resolve("scripts", script)], {
    stdio: "inherit",
    env: { ...process.env, EVIDENCE_DIR: resolve(directory, folder) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
