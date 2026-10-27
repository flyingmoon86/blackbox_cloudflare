import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../types";
import { reserveStorage, storageCommitStatements } from "./upload-policy";
import { drainFileCleanup } from "./file-cleanup";

/** Both private legacy photos and profile selections use the same recoverable write path. */
export async function storeMemberPhoto(
  env: Bindings,
  userId: number,
  file: FormDataEntryValue | null,
  insert: (key: string) => D1PreparedStatement,
) {
  if (!(file instanceof File) || !file.size || file.size > 8 * 1024 * 1024)
    throw new HTTPException(400, { message: "请选择 8MB 以内的 JPG、PNG 或 WebP 照片。" });
  const bytes = new Uint8Array(await file.arrayBuffer()),
    header = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  const ext =
    file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "jpg"
      : file.type === "image/png" &&
          bytes.length >= 8 &&
          [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
        ? "png"
        : file.type === "image/webp" && header.startsWith("RIFF") && header.slice(8) === "WEBP"
          ? "webp"
          : null;
  if (!ext) throw new HTTPException(400, { message: "图片内容与格式不一致。" });
  const key = `member-photos/${crypto.randomUUID()}.${ext}`,
    reservation = "member-photo:" + crypto.randomUUID();
  await reserveStorage(env, { id: reservation, bytes: bytes.length, userId, kind: "upload" });
  await env.DB.prepare(
    "INSERT INTO file_cleanup_task(object_key,reservation_id,next_attempt_at) VALUES(?,?,datetime('now','+10 minutes'))",
  )
    .bind(key, reservation)
    .run();
  try {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: file.type } });
    const result = await env.DB.batch([
      insert(key),
      ...storageCommitStatements(env, reservation, [{ key, size: bytes.length }]),
      env.DB.prepare(
        "DELETE FROM file_cleanup_task WHERE object_key=? AND (EXISTS(SELECT 1 FROM member_featured_photo WHERE object_key=?) OR EXISTS(SELECT 1 FROM member_record_photo WHERE object_key=?))",
      ).bind(key, key, key),
    ]);
    if (result[0].meta.changes < 1) throw new HTTPException(409, { message: "资料状态已变化，请刷新核对后重试。" });
  } catch (error) {
    await env.DB.prepare("UPDATE file_cleanup_task SET next_attempt_at=CURRENT_TIMESTAMP WHERE object_key=?")
      .bind(key)
      .run();
    throw error;
  } finally {
    await drainFileCleanup(env).catch(() => console.error(JSON.stringify({ event: "member_photo_cleanup_retry" })));
  }
}
