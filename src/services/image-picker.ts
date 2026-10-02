import type { Context } from "hono";
import type { AppEnv } from "../types";

const fields = new Set([
  "hero_photo",
  "mascot_photo",
  "productions_background",
  "members_background",
  "thanks_background",
  "recruitment_poster",
  "recruitment_poster_mobile",
  "cover_id",
]);
const needsPreview = new Set([
  "productions_background",
  "members_background",
  "thanks_background",
  "recruitment_poster",
  "recruitment_poster_mobile",
]);

// Read-only chooser. Eligibility mirrors the existing save handlers; it never repairs associations.
export async function imageOptions(c: Context<AppEnv>) {
  if (c.get("user")?.role !== "admin") return c.json({ error: "只有管理员可以选择图片。" }, 403);
  c.header("Cache-Control", "private, no-store");
  const field = c.req.query("field") || "";
  if (!fields.has(field)) return c.json({ error: "图片用途无效。" }, 400);
  const mode = c.req.query("mode") || "groups";
  if (mode !== "groups" && mode !== "images") return c.json({ error: "查询方式无效。" }, 400);
  const params: Array<string | number> = [];
  let eligible = "r.status='approved' AND (r.res_type='photo' OR ?='hero_photo')";
  params.push(field);
  if (needsPreview.has(field)) eligible += " AND r.preview_filename IS NOT NULL AND r.preview_filename<>''";
  if (field === "cover_id") {
    const text = c.req.query("production") || "";
    const id = Number(text);
    if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(id)) return c.json({ error: "请选择有效的作品。" }, 400);
    if (!(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(id).first()))
      return c.json({ error: "作品不存在。" }, 404);
    eligible += " AND r.production_id=?";
    params.push(id);
  }
  const base = `WITH images AS (
    SELECT r.id,r.title,r.production_id,p.title production_title,pe.name edition_name,
      CASE
        WHEN r.production_id IS NULL AND r.edition_id IS NULL THEN 'unlinked'
        WHEN p.id IS NULL OR (r.edition_id IS NOT NULL AND (pe.id IS NULL OR pe.production_id<>r.production_id)) THEN 'issues'
        ELSE 'production:'||p.id END group_key,
      CASE
        WHEN r.production_id IS NULL AND r.edition_id IS NOT NULL THEN '有版本关联，但未关联作品'
        WHEN r.production_id IS NOT NULL AND p.id IS NULL THEN '关联作品不存在'
        WHEN r.edition_id IS NOT NULL AND pe.id IS NULL THEN '关联版本不存在'
        WHEN pe.production_id<>r.production_id THEN '版本与作品不一致'
        ELSE '' END issue
    FROM resource r LEFT JOIN production p ON p.id=r.production_id
    LEFT JOIN production_edition pe ON pe.id=r.edition_id WHERE ${eligible}
  )`;
  if (mode === "groups") {
    const rows = await c.env.DB.prepare(
      `${base} SELECT group_key,MAX(production_title) title,COUNT(*) count FROM images GROUP BY group_key ORDER BY MAX(id) DESC`,
    )
      .bind(...params)
      .all<{ group_key: string; title: string | null; count: number }>();
    return c.json({
      groups: rows.results.map((row) => ({
        key: row.group_key,
        title:
          row.group_key === "unlinked"
            ? "未关联作品"
            : row.group_key === "issues"
              ? "关联信息异常"
              : row.title?.trim() || `未命名作品 #${row.group_key.split(":")[1]}`,
        count: row.count,
      })),
    });
  }
  const group = c.req.query("group") || "";
  const search = (c.req.query("q") || "").trim().slice(0, 80);
  if (group && !/^(unlinked|issues|production:[1-9]\d*)$/.test(group)) return c.json({ error: "分类无效。" }, 400);
  if (!group && !search) return c.json({ error: "请先选择分类或输入搜索词。" }, 400);
  const filters: string[] = [];
  if (group) {
    filters.push("group_key=?");
    params.push(group);
  }
  if (search) {
    filters.push(
      "(title LIKE ? ESCAPE '\\' OR production_title LIKE ? ESCAPE '\\' OR edition_name LIKE ? ESCAPE '\\')",
    );
    const term = `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    params.push(term, term, term);
  }
  const where = `WHERE ${filters.join(" AND ")}`;
  const total =
    (
      await c.env.DB.prepare(`${base} SELECT COUNT(*) n FROM images ${where}`)
        .bind(...params)
        .first<{ n: number }>()
    )?.n || 0;
  const size = 12,
    pages = Math.max(1, Math.ceil(total / size));
  const requested = Number(c.req.query("page") || 1);
  const page = Math.min(pages, Number.isSafeInteger(requested) && requested > 0 ? requested : 1);
  const items = await c.env.DB.prepare(
    `${base} SELECT id,title,production_id,production_title,edition_name,group_key,issue FROM images ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, size, (page - 1) * size)
    .all();
  return c.json({ items: items.results, page, pages, total, size });
}
