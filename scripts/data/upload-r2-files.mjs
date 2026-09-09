import { open, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { AwsClient } from "aws4fetch";

const manifestPath = resolve(process.argv[2] || "migration-work/converted/r2-files.json");
const legacyRoot = resolve(process.argv[3] || "legacy-python");
const local = process.argv.includes("--local");
const bucket = process.env.R2_BUCKET_NAME || "blackbox-files";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("R2 文件清单格式不正确。");

const existingSource = async (sources) => {
  for (const source of sources) {
    const path = resolve(legacyRoot, source);
    try {
      const info = await stat(path);
      if (info.isFile()) return { path, size: info.size };
    } catch {}
  }
  return null;
};
const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");
const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
const xmlEscape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

let aws;
if (!local) {
  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"])
    if (!process.env[name]) throw new Error(`远程上传缺少 ${name}`);
  aws = new AwsClient({
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
    retries: 3,
  });
}
const objectUrl = (key) =>
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(bucket)}/${encodeKey(key)}`;
const checked = async (response, action) => {
  if (response.ok) return response;
  throw new Error(`${action}失败：${response.status} ${(await response.text()).slice(0, 300)}`);
};

async function uploadRemote(entry, source) {
  const url = objectUrl(entry.objectKey);
  const head = await aws.fetch(url, { method: "HEAD" });
  if (head.ok && Number(head.headers.get("content-length")) === source.size) {
    console.log(`已存在，跳过：${entry.objectKey}`);
    return;
  }
  const created = await checked(
    await aws.fetch(`${url}?uploads`, {
      method: "POST",
      headers: { "content-type": entry.contentType || "application/octet-stream" },
    }),
    "创建 multipart",
  );
  const uploadId = xmlValue(await created.text(), "UploadId");
  if (!uploadId) throw new Error("R2 未返回 uploadId");
  const partSize = 50 * 1024 * 1024,
    total = Math.ceil(source.size / partSize),
    handle = await open(source.path, "r");
  try {
    const parts = [];
    let next = 1;
    const worker = async () => {
      while (next <= total) {
        const partNumber = next++;
        const start = (partNumber - 1) * partSize,
          length = Math.min(partSize, source.size - start),
          buffer = Buffer.allocUnsafe(length);
        await handle.read(buffer, 0, length, start);
        const partUrl = new URL(url);
        partUrl.searchParams.set("partNumber", String(partNumber));
        partUrl.searchParams.set("uploadId", uploadId);
        const response = await checked(
          await aws.fetch(partUrl, { method: "PUT", body: buffer }),
          `上传第 ${partNumber} 片`,
        );
        const etag = response.headers.get("etag");
        if (!etag) throw new Error(`第 ${partNumber} 片缺少 ETag`);
        parts.push({ partNumber, etag });
        console.log(`${entry.objectKey}：${partNumber}/${total}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
    parts.sort((a, b) => a.partNumber - b.partNumber);
    const completeUrl = new URL(url);
    completeUrl.searchParams.set("uploadId", uploadId);
    const body = `<CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
    await checked(
      await aws.fetch(completeUrl, { method: "POST", headers: { "content-type": "application/xml" }, body }),
      "合并 multipart",
    );
  } catch (error) {
    const abortUrl = new URL(url);
    abortUrl.searchParams.set("uploadId", uploadId);
    await aws.fetch(abortUrl, { method: "DELETE" }).catch(() => {});
    throw error;
  } finally {
    await handle.close();
  }
}

async function uploadLocal(entry, source) {
  const wrapper = resolve("scripts/wrangler.mjs");
  const result = spawnSync(
    process.execPath,
    [wrapper, "r2", "object", "put", `${bucket}/${entry.objectKey}`, "--file", source.path, "--local", "--force"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error(`本地上传失败：${entry.objectKey}`);
}

const missing = [];
for (const entry of manifest.files) {
  const source = await existingSource(entry.sources || []);
  if (!source) {
    missing.push({ objectKey: entry.objectKey, sources: entry.sources });
    continue;
  }
  console.log(`上传：${source.path} -> ${entry.objectKey}`);
  if (local) await uploadLocal(entry, source);
  else await uploadRemote(entry, source);
}
if (missing.length) {
  console.error(JSON.stringify(missing, null, 2));
  throw new Error(`有 ${missing.length} 个旧文件未找到，请先补齐后重试。`);
}
console.log(`R2 文件迁移完成，共 ${manifest.files.length} 个对象。`);
