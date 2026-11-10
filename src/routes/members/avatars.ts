import { matchesImageMime } from "../../services/image-format";
import { replaceAvatar, queueCurrentAvatar } from "../../services/avatars";
import { drainFileCleanup } from "../../services/file-cleanup";
import { serveResourceFile } from "../../services/resource-files";
import { consumeAccountLimit } from "../../middleware/request-limits";
import { readBoundedBody } from "../../http/validation";
import { Hono } from "hono";
import { csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";

const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

function validImage(bytes: Uint8Array, type: string): boolean {
  return bytes.length >= 12 && matchesImageMime(bytes, type);
}

export function registerAvatarsMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.post("/profile/member/avatar", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "member" || !user.member_id) return c.text("只有已认证队员能上传头像。", 403);
    const form = await new Response(await readBoundedBody(c.req.raw, 16 * 1024 * 1024), {
      headers: c.req.raw.headers,
    }).formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const file = form.get("avatar");
    if (!(file instanceof File) || !IMAGE_TYPES[file.type] || file.size < 1 || file.size > 15 * 1024 * 1024)
      return c.text("请选择 15MB 以内的 JPG、PNG、WebP 或 AVIF 图片。", 400);
    const data = new Uint8Array(await file.arrayBuffer());
    if (!validImage(data, file.type)) return c.text("图片内容与格式不一致。", 400);
    const retry = await consumeAccountLimit(c, "avatar", 20);
    if (retry) {
      c.header("Retry-After", String(retry));
      return c.text("更换头像次数较多，请稍后重试。", 429);
    }
    const previewFile = form.get("avatar_preview");
    let preview: Uint8Array | undefined;
    if (previewFile instanceof File && previewFile.size > 0) {
      if (previewFile.type !== "image/jpeg" || previewFile.size > 512 * 1024)
        return c.text("头像展示图格式或大小不正确。", 400);
      preview = new Uint8Array(await previewFile.arrayBuffer());
      if (!validImage(preview, "image/jpeg")) return c.text("头像展示图内容不正确。", 400);
    }
    await replaceAvatar(c.env, user.id, user.member_id, IMAGE_TYPES[file.type], file.type, data, preview);
    return c.redirect("/profile/member?saved=1", 303);
  });

  memberRoutes.get("/members/:id/avatar", async (c) => {
    const row = await c.env.DB.prepare("SELECT photo,avatar_preview FROM member WHERE id=?")
      .bind(Number(c.req.param("id")))
      .first<{ photo: string; avatar_preview: string }>();
    if (!row?.photo) return c.text("头像不存在。", 404);
    // Detail portraits and zoom need the original; list cards retain the lightweight preview.
    const key = c.req.query("size") === "original" ? row.photo : row.avatar_preview || row.photo;
    return serveResourceFile(c.req.raw, c.env.FILES, { key });
  });

  memberRoutes.post("/admin/members/:id/avatar/delete", async (c) => {
    const user = c.get("user")!;
    if (user.role !== "admin") return c.text("没有管理员权限。", 403);
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
    const id = Number(c.req.param("id"));
    const row = await c.env.DB.prepare("SELECT photo FROM member WHERE id=?").bind(id).first<{ photo: string }>();
    if (!row) return c.text("未找到队员档案。", 404);
    await c.env.DB.batch([
      queueCurrentAvatar(c.env, id),
      c.env.DB.prepare("UPDATE member SET photo='',avatar_preview='' WHERE id=?").bind(id),
    ]);
    await drainFileCleanup(c.env);
    return c.redirect(`/admin/members/${id}/edit?saved=1`, 303);
  });
}
