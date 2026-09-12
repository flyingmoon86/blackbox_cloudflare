import type { Bindings } from "../types";
import { HTTPException } from "hono/http-exception";
import { reserveStorage, storageCommitStatements } from "./upload-policy";
import { drainFileCleanup } from "./file-cleanup";

export function queueCurrentAvatar(env: Bindings, memberId: number): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO file_cleanup_task(object_key) SELECT photo FROM member WHERE id=? AND photo LIKE 'member-avatars/%' UNION SELECT avatar_preview FROM member WHERE id=? AND avatar_preview LIKE 'member-avatars/%' ON CONFLICT(object_key) DO UPDATE SET next_attempt_at=CURRENT_TIMESTAMP",
  ).bind(memberId, memberId);
}

/** Record cleanup before PUT; an interrupted request leaves a recoverable intent.
 * Read the replaced photo inside the same D1 batch as the replacement, avoiding stale reads.
 */
export async function replaceAvatar(
  env: Bindings,
  userId: number,
  memberId: number,
  extension: string,
  mime: string,
  data: Uint8Array,
  preview?: Uint8Array,
): Promise<void> {
  const id = "avatar:" + crypto.randomUUID(),
    key = "member-avatars/" + memberId + "/" + crypto.randomUUID() + "." + extension;
  const previewKey = preview ? key + ".preview.jpg" : "";
  await reserveStorage(env, { id, bytes: data.byteLength + (preview?.byteLength || 0), userId, kind: "avatar" });
  await env.DB.prepare(
    "INSERT INTO file_cleanup_task(object_key,reservation_id,next_attempt_at) VALUES(?,?,datetime('now','+10 minutes'))",
  )
    .bind(key, id)
    .run();
  try {
    if (previewKey) {
      await env.DB.prepare(
        "INSERT INTO file_cleanup_task(object_key,reservation_id,next_attempt_at) VALUES(?,?,datetime('now','+10 minutes'))",
      )
        .bind(previewKey, id)
        .run();
      await env.FILES.put(previewKey, preview!, { httpMetadata: { contentType: "image/jpeg" } });
    }
    await env.FILES.put(key, data, { httpMetadata: { contentType: mime } });
    const result = await env.DB.batch([
      queueCurrentAvatar(env, memberId),
      env.DB.prepare(
        "UPDATE member SET photo=?,avatar_preview=? WHERE id=? AND EXISTS(SELECT 1 FROM user WHERE id=? AND member_id=? AND role='member' AND status='active')",
      ).bind(key, previewKey, memberId, userId, memberId),
      ...storageCommitStatements(env, id, [
        { key, size: data.byteLength },
        ...(preview ? [{ key: previewKey, size: preview.byteLength }] : []),
      ]),
      env.DB.prepare(
        "DELETE FROM file_cleanup_task WHERE object_key IN (?,?) AND EXISTS(SELECT 1 FROM member WHERE id=? AND photo=?)",
      ).bind(key, previewKey, memberId, key),
    ]);
    if (result[1].meta.changes !== 1) throw new HTTPException(409, { message: "账号与档案状态已变化，请刷新后重试。" });
  } catch (error) {
    await env.DB.prepare("UPDATE file_cleanup_task SET next_attempt_at=CURRENT_TIMESTAMP WHERE object_key IN (?,?)")
      .bind(key, previewKey)
      .run();
    throw error;
  } finally {
    await drainFileCleanup(env).catch(() => console.error(JSON.stringify({ event: "avatar_cleanup_retry" })));
  }
}
