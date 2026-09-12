import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";
import { spawnSync } from "node:child_process";

const environment = { ...process.env };
const proxyNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const markdownLink = /^\[(https?:\/\/[^\]]+)\]\(\1\)$/;

for (const name of proxyNames) {
  const value = environment[name];
  const match = value?.match(markdownLink);
  if (match) environment[name] = match[1];
}

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
let assetWatcher, assetTimer;
if (process.argv[2] === "dev") {
  assetWatcher = watch("public", { recursive: true }, (_, file) => {
    if (!file || file.startsWith("assets")) return;
    clearTimeout(assetTimer);
    assetTimer = setTimeout(() => spawnSync(process.execPath, ["scripts/build-assets.mjs"], { stdio: "inherit" }), 150);
  });
}
const child = spawn(process.execPath, [wrangler, ...process.argv.slice(2)], {
  env: environment,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(`无法启动 Wrangler：${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  assetWatcher?.close();
  clearTimeout(assetTimer);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
