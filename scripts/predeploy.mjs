import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8"));
const production = config.env?.production;
const database = production?.d1_databases?.find((item) => item.binding === "DB");
const bucket = production?.r2_buckets?.find((item) => item.binding === "FILES");
const route = production?.routes?.find((item) => item.custom_domain);
const requiredSecrets = new Set(production?.secrets?.required || []);
const expectedSecrets = ["SESSION_SECRET"];

const problems = [];
if (!production) problems.push("缺少 env.production 正式环境配置");
if (!database || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(database.database_id || ""))
  problems.push("D1 database_id 仍是占位值");
if (!bucket || !bucket.bucket_name || bucket.bucket_name.startsWith("REPLACE_"))
  problems.push("R2 bucket_name 仍是占位值");
if (!route || !route.pattern || route.pattern.startsWith("REPLACE_") || route.pattern.includes("://"))
  problems.push("正式域名仍是占位值；只填写域名，不要包含 https:// 或路径");
for (const secret of expectedSecrets) if (!requiredSecrets.has(secret)) problems.push(`未声明必需 Secret：${secret}`);
if (bucket && production?.vars?.R2_BUCKET_NAME !== bucket.bucket_name)
  problems.push("R2 绑定名称与 R2_BUCKET_NAME 不一致");

if (problems.length) {
  console.error("正式部署检查未通过：\n- " + problems.join("\n- "));
  console.error("请先按 docs/架构与部署.md 填好 Cloudflare 资源信息。没有通过检查时不会部署。 ");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function npmRun(script) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error("请通过 npm run 执行部署检查。");
  run(process.execPath, [npmCli, "run", script]);
}

function wrangler(...args) {
  run(process.execPath, [fileURLToPath(new URL("./wrangler.mjs", import.meta.url)), ...args]);
}

const action = process.argv[2] || "check";
if (action === "check") {
  npmRun("format:check");
  npmRun("typecheck");
  npmRun("data:test");
  npmRun("test:backend");
  wrangler("deploy", "--env", "production", "--dry-run", "--outdir", ".wrangler/production-dry-run");
  console.log("正式部署前代码、数据转换与配置检查通过。此命令没有发布网站。");
} else if (action === "migrate") {
  wrangler("d1", "migrations", "apply", database.database_name, "--remote", "--env", "production");
} else if (action === "backup") {
  const backupDirectory = fileURLToPath(new URL("../migration-work/backups", import.meta.url));
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  const output = `${backupDirectory}/blackbox-production-${timestamp}.sql`;
  wrangler("d1", "export", database.database_name, "--remote", "--env", "production", "--output", output);
  console.log(`D1 备份已保存：${output}`);
} else if (action === "cors") {
  const corsPath = fileURLToPath(new URL("../.wrangler/r2-cors.production.json", import.meta.url));
  mkdirSync(fileURLToPath(new URL("../.wrangler", import.meta.url)), { recursive: true });
  writeFileSync(
    corsPath,
    JSON.stringify(
      {
        rules: [
          {
            allowed: {
              origins: [`https://${route.pattern}`],
              methods: ["PUT"],
              headers: ["content-type"],
            },
            exposeHeaders: ["etag"],
            maxAgeSeconds: 3600,
          },
        ],
      },
      null,
      2,
    ),
  );
  wrangler("r2", "bucket", "cors", "set", bucket.bucket_name, "--file", corsPath);
} else if (action === "deploy") {
  wrangler("deploy", "--env", "production");
} else if (action === "smoke") {
  const origin = `https://${route.pattern}`;
  const checks = [
    ["首页", "/", 200, "text/html"],
    ["健康检查", "/health", 200, "application/json"],
    ["静态样式", "/app.css", 200, "text/css"],
    ["作品公开浏览", "/productions", 200, "text/html"],
    ["公告公开浏览", "/announcements", 200, "text/html"],
    ["队员公开浏览", "/members", 200, "text/html"],
    ["资料公开浏览", "/resources", 200, "text/html"],
    ["鸣谢", "/thanks", 200, "text/html"],
    ["后台保护", "/admin", 302, null],
  ];
  for (const [label, path, expectedStatus, expectedType] of checks) {
    const response = await fetch(`${origin}${path}`, { redirect: "manual" });
    const type = response.headers.get("content-type") || "";
    if (response.status !== expectedStatus || (expectedType && !type.includes(expectedType)))
      throw new Error(`${label}检查失败：HTTP ${response.status}，Content-Type ${type || "缺失"}`);
    if (path === "/health" && !(await response.json()).ok) throw new Error("健康检查内容不正确。");
    console.log(`通过：${label}`);
  }
} else {
  console.error(`未知操作：${action}`);
  process.exit(1);
}
