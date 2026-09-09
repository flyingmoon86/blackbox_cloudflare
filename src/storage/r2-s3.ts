import { AwsClient } from "aws4fetch";
import type { Bindings } from "../types";

export type CompletedPart = { partNumber: number; etag: string };

export function usesDirectR2(env: Bindings): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

function client(env: Bindings): AwsClient {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    service: "s3",
    region: "auto",
    retries: 2,
  });
}

function objectUrl(env: Bindings, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(env.R2_BUCKET_NAME!)}/${path}`;
}

function xmlValue(xml: string, tag: string): string | null {
  const value = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
  return value
    ? value
        .replaceAll("&amp;", "&")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&#39;", "'")
    : null;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function checked(response: Response, action: string): Promise<Response> {
  if (response.ok) return response;
  throw new Error(`${action}失败：${response.status} ${(await response.text()).slice(0, 300)}`);
}

export async function createDirectUpload(env: Bindings, key: string, contentType: string): Promise<string> {
  const response = await checked(
    await client(env).fetch(`${objectUrl(env, key)}?uploads`, {
      method: "POST",
      headers: { "content-type": contentType },
    }),
    "创建 R2 分片任务",
  );
  const uploadId = xmlValue(await response.text(), "UploadId");
  if (!uploadId) throw new Error("R2 未返回 uploadId");
  return uploadId;
}

export async function presignDirectPart(
  env: Bindings,
  key: string,
  uploadId: string,
  partNumber: number,
): Promise<string> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", "900");
  const request = await client(env).sign(url, {
    method: "PUT",
    aws: { signQuery: true, service: "s3", region: "auto" },
  });
  return request.url;
}

export async function completeDirectUpload(
  env: Bindings,
  key: string,
  uploadId: string,
  parts: CompletedPart[],
): Promise<void> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("uploadId", uploadId);
  const body = `<CompleteMultipartUpload>${parts.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  await checked(
    await client(env).fetch(url, { method: "POST", headers: { "content-type": "application/xml" }, body }),
    "完成 R2 分片任务",
  );
}

export async function abortDirectUpload(env: Bindings, key: string, uploadId: string): Promise<void> {
  const url = new URL(objectUrl(env, key));
  url.searchParams.set("uploadId", uploadId);
  await checked(await client(env).fetch(url, { method: "DELETE" }), "取消 R2 分片任务");
}
