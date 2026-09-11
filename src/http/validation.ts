import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { AppEnv } from "../types";

/** Keep redirect targets relative to this site, including after URL normalization. */
export function safeNext(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/")) return "/";
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u001f\u007f]/.test(value + decoded)) return "/";
    const base = "https://blackbox.invalid";
    const url = new URL(value, base);
    const decodedUrl = new URL(decoded, base);
    if (url.origin !== base || decodedUrl.origin !== base) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

/** Bound actual bytes before form parsing; do not trust Content-Length alone. */
export async function authForm(c: Context<AppEnv>): Promise<FormData> {
  const limit = 16 * 1024;
  const body = c.req.raw.body;
  if (!body) throw new HTTPException(400, { message: "请填写表单后重试。" });
  const reader = body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HTTPException(413, { message: "表单内容过长，请缩短后重试。" });
      }
      chunks.push(value);
    }
    return await new Response(new Blob(chunks), { headers: c.req.raw.headers }).formData();
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: "表单格式不正确，请刷新页面后重试。" });
  } finally {
    reader.releaseLock();
  }
}

export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  if (value !== null && typeof value !== "string") throw new HTTPException(400, { message: "表单字段格式不正确。" });
  return value ?? "";
}

export async function readBoundedBody(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw new HTTPException(400, { message: "请求内容为空。" });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HTTPException(413, { message: "请求内容超过大小限制。" });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
}
