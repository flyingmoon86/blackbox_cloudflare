import { spawnSync } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const uv = join(projectRoot, ".tools", "bin", "uv.exe");
const environment = {
  ...process.env,
  PATH: `${dirname(uv)}${delimiter}${process.env.PATH ?? ""}`,
  UV_CACHE_DIR: join(projectRoot, ".tools", "cache"),
  UV_PYTHON_INSTALL_DIR: join(projectRoot, ".tools", "python"),
  UV_LINK_MODE: "copy",
};

const result = spawnSync(
  uv,
  ["run", "pywrangler", ...process.argv.slice(2)],
  { cwd: projectRoot, env: environment, stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
