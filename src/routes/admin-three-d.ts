import { Hono, type Context } from "hono";
import { csrfFor, csrfValid } from "../http/cookies";
import { serveResourceFile } from "../services/resource-files";
import { serveThreeDModel } from "../services/three-d-transfer";
import { getThreeDScene, threeDSceneFiles, type ThreeDScene } from "../services/three-d";
import type { AppEnv } from "../types";
import { threeDAdminEditPage, threeDAdminListPage } from "../views/admin-three-d";
import { threeDArchivePage } from "../views/three-d";

export const threeDAdminRoutes = new Hono<AppEnv>();
const base = "/admin/three-d";
const flashes: ReadonlyMap<string, string> = new Map([
  ["created", "草稿已创建，可以上传模型和封面。"],
  ["saved", "场景资料已保存。"],
  ["published", "场景和待发布文件已发布。"],
  ["archived", "场景已下架。"],
]);

threeDAdminRoutes.use(base + "/*", async (c, next) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login?next=" + encodeURIComponent(c.req.path));
  if (user.role !== "admin") return c.text("没有管理员权限。", 403);
  await next();
});

function numberField(value: FormDataEntryValue | null, min: number, max: number): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : null;
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function getFlash(c: Context<AppEnv>) {
  return flashes.get(c.req.query("result") || "");
}

function editUrl(id: string) {
  return base + "/" + encodeURIComponent(id);
}

async function editPage(c: Context<AppEnv>, scene?: ThreeDScene) {
  const [productions, editions, csrf] = await Promise.all([
    c.env.DB.prepare("SELECT id,title FROM production ORDER BY title,id").all<{ id: number; title: string }>(),
    c.env.DB.prepare("SELECT id,production_id,name,year FROM production_edition ORDER BY year DESC,id").all<{
      id: number;
      production_id: number;
      name: string;
      year: number | null;
    }>(),
    csrfFor(c),
  ]);
  return c.html(
    threeDAdminEditPage({
      scene,
      productions: productions.results,
      editions: editions.results,
      csrf,
      flash: getFlash(c),
    }),
  );
}

threeDAdminRoutes.get(base, async (c) => {
  const scenes = await c.env.DB.prepare("SELECT * FROM three_d_scene ORDER BY sort_order,id").all<ThreeDScene>();
  return c.html(threeDAdminListPage(scenes.results, getFlash(c)));
});

threeDAdminRoutes.get(base + "/new", (c) => editPage(c));

threeDAdminRoutes.get(`${base}/:id`, async (c) => {
  const scene = await getThreeDScene(c.env.DB, c.req.param("id"));
  return scene ? editPage(c, scene) : c.notFound();
});

async function metadata(c: Context<AppEnv>, form: FormData) {
  const title = textField(form, "title");
  const description = textField(form, "description");
  const order = numberField(form.get("sort_order") ?? "0", 0, 9999);
  const production = textField(form, "production_id");
  const edition = textField(form, "edition_id");
  const productionId = numberField(production, 1, Number.MAX_SAFE_INTEGER);
  const editionId = numberField(edition, 1, Number.MAX_SAFE_INTEGER);
  if (!title || title.length > 100 || description.length > 2000 || order === null)
    return { ok: false, error: "请填写标题（最多 100 字）、简介（最多 2000 字）和 0 至 9999 的排序值。" } as const;
  if ((production && !productionId) || (edition && (!editionId || !productionId)))
    return { ok: false, error: "请选择有效的关联作品和演出版本。" } as const;
  if (productionId && !(await c.env.DB.prepare("SELECT 1 FROM production WHERE id=?").bind(productionId).first()))
    return { ok: false, error: "关联作品已不存在。" } as const;
  if (
    editionId &&
    !(await c.env.DB.prepare("SELECT 1 FROM production_edition WHERE id=? AND production_id=?")
      .bind(editionId, productionId)
      .first())
  )
    return { ok: false, error: "演出版本不属于所选作品。" } as const;
  return { ok: true, fields: [title, description, order, productionId, editionId] } as const;
}

threeDAdminRoutes.post(base, async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const values = await metadata(c, form);
  if (!values.ok) return c.text(values.error, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO three_d_scene(id,title,description,sort_order,production_id,edition_id) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, ...values.fields)
    .run();
  return c.redirect(editUrl(id) + "?result=created", 303);
});

threeDAdminRoutes.post(`${base}/:id`, async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const id = c.req.param("id");
  if (!(await getThreeDScene(c.env.DB, id))) return c.notFound();
  const values = await metadata(c, form);
  if (!values.ok) return c.text(values.error, 400);
  const revision = numberField(form.get("revision"), 0, Number.MAX_SAFE_INTEGER);
  const result = await c.env.DB.prepare(
    "UPDATE three_d_scene SET title=?,description=?,sort_order=?,production_id=?,edition_id=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",
  )
    .bind(...values.fields, id, revision)
    .run();
  if (result.meta.changes !== 1) return c.text("场景已更新，请刷新页面后重试。", 409);
  return c.redirect(editUrl(id) + "?result=saved", 303);
});

threeDAdminRoutes.post(`${base}/:id/publish`, async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const scene = await getThreeDScene(c.env.DB, c.req.param("id"));
  if (!scene) return c.notFound();
  if (numberField(form.get("revision"), 0, Number.MAX_SAFE_INTEGER) !== scene.revision)
    return c.text("场景已更新，请刷新页面后重试。", 409);
  const { model, cover } = threeDSceneFiles(scene, true);
  if (!model.key || !cover.key) return c.text("上传模型和封面后才可以发布。", 400);
  const files = await Promise.all([c.env.FILES.head(model.key), c.env.FILES.head(cover.key)]);
  if (files.some((file) => !file?.size)) return c.text("模型或封面文件缺失，请重新上传。", 409);
  const update = c.env.DB.prepare(
    `UPDATE three_d_scene SET status='published',model_key=?,model_filename=?,cover_key=?,cover_filename=?,
       pending_model_key=NULL,pending_model_filename=NULL,pending_cover_key=NULL,pending_cover_filename=NULL,
       revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?`,
  ).bind(model.key, model.name, cover.key, cover.name, scene.id, scene.revision);
  // Retain the four original objects for rollback to the pre-migration viewer.
  const retired = [scene.model_key, scene.cover_key].filter((key): key is string =>
    Boolean(
      key && key !== model.key && key !== cover.key && !/^three-d-archive\/(03|05)\/(model\.ply|cover\.jpg)$/.test(key),
    ),
  );
  const cleanup = retired.map((key) =>
    c.env.DB.prepare(
      `INSERT INTO file_cleanup_task(object_key)
       SELECT ? WHERE NOT EXISTS(SELECT 1 FROM three_d_scene WHERE ? IN (model_key,cover_key,pending_model_key,pending_cover_key))
       ON CONFLICT(object_key) DO NOTHING`,
    ).bind(key, key),
  );
  const [result] = await c.env.DB.batch([update, ...cleanup]);
  if (result.meta.changes !== 1) return c.text("场景已更新，请刷新页面后重试。", 409);
  return c.redirect(editUrl(scene.id) + "?result=published", 303);
});

threeDAdminRoutes.post(`${base}/:id/archive`, async (c) => {
  const form = await c.req.formData();
  if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
  const id = c.req.param("id");
  if (!(await getThreeDScene(c.env.DB, id))) return c.notFound();
  const revision = numberField(form.get("revision"), 0, Number.MAX_SAFE_INTEGER);
  const result = await c.env.DB.prepare(
    "UPDATE three_d_scene SET status='archived',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",
  )
    .bind(id, revision)
    .run();
  if (result.meta.changes !== 1) return c.text("场景已更新，请刷新页面后重试。", 409);
  return c.redirect(editUrl(id) + "?result=archived", 303);
});

threeDAdminRoutes.get(`${base}/:id/preview`, async (c) => {
  const scene = await getThreeDScene(c.env.DB, c.req.param("id"));
  if (!scene) return c.notFound();
  const { model, cover } = threeDSceneFiles(scene, true);
  if (!model.key) return c.text("上传模型后才可以预览。", 409);
  return c.html(threeDArchivePage([scene], true, true, { hasCover: Boolean(cover.key) }));
});

threeDAdminRoutes.on(["GET", "HEAD"], `${base}/:id/preview/:kind`, async (c) => {
  const kind = c.req.param("kind");
  if (kind !== "cover" && kind !== "model") return c.notFound();
  const scene = await getThreeDScene(c.env.DB, c.req.param("id"));
  if (!scene) return c.notFound();
  const file = threeDSceneFiles(scene, true)[kind];
  if (!file.key) return c.notFound();
  const response =
    kind === "model"
      ? await serveThreeDModel(c.req.raw, c.env.FILES, file.key, file.name || "model.ply")
      : await serveResourceFile(c.req.raw, c.env.FILES, {
          key: file.key,
          filename: file.name || (kind === "cover" ? "cover.jpg" : "model.ply"),
        });
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, { status: response.status, headers });
});
