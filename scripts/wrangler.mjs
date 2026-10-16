import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { watch } from "node:fs";
import { spawnSync } from "node:child_process";
import { generatedBrowserScripts } from "./client-entries.mjs";

const environment = { ...process.env };
const proxyNames = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const markdownLink = /^\[(https?:\/\/[^\]]+)\]\(\1\)$/;

for (const name of proxyNames) {
  const value = environment[name];
  const match = value?.match(markdownLink);
  if (match) environment[name] = match[1];
}

const wrangler = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const assetWatchers = [];
let assetTimer;
if (process.argv[2] === "dev") {
  for (const root of ["public", "src/client", "src/shared"]) {
    assetWatchers.push(
      watch(root, { recursive: true }, (_, file) => {
        // Build outputs must not trigger another build (and an endless dev reload).
        const path = file?.replaceAll("\\", "/");
        if (!path || (root === "public" && (path.startsWith("assets/") || generatedBrowserScripts.has(path)))) return;
        clearTimeout(assetTimer);
        assetTimer = setTimeout(() => {
          const result = spawnSync(process.execPath, ["scripts/build-assets.mjs"], { stdio: "inherit" });
          if (result.error) console.error(result.error.message);
          else if (result.status !== 0) console.error("静态资源构建失败，请检查上方错误。");
          else console.log("静态资源已重新构建。");
        }, 150);
      }),
    );
  }
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
  assetWatchers.forEach((watcher) => watcher.close());
  clearTimeout(assetTimer);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
