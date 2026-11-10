import { invalidateSiteProfile } from "../../services/site-profile";
import { validAccent } from "../../services/theme";
import { Hono } from "hono";
import { csrfFor, csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { productionFormPage } from "../../views/productions";
import type { ProductionRow } from "../../services/productions/types";
import { saveProduction } from "../../services/productions/save";
import { selectedResourcesAllowed, resourceChoices } from "../../services/productions/queries";
import { selectedResourceIds, hiddenValue } from "../../services/productions/forms";
import { adminOnly } from "../../http/authorization";

export function registerAdminRoutes(productionRoutes: Hono<AppEnv>) {
  productionRoutes.get("/admin/productions/new", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    return c.html(productionFormPage(null, await csrfFor(c), [], await resourceChoices(c.env.DB, null)));
  });

  productionRoutes.post("/admin/productions/:id/visibility", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新后重试。", 400);
    const hidden = hiddenValue(form);
    if (hidden === null || Number.isNaN(hidden)) return c.text("可见性无效。", 400);
    if (!Number.isSafeInteger(Number(c.req.param("id"))) || Number(c.req.param("id")) <= 0)
      return c.text("未找到这部作品。", 404);
    const result = await c.env.DB.prepare("UPDATE production SET is_hidden=? WHERE id=?")
      .bind(hidden, Number(c.req.param("id")))
      .run();
    if (!result.meta.changes) return c.text("未找到这部作品。", 404);
    await invalidateSiteProfile(c);
    return c.redirect("/productions", 303);
  });

  productionRoutes.post("/admin/productions/new", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    const hidden = hiddenValue(form);
    if (Number.isNaN(hidden)) return c.text("可见性无效。", 400);
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const theme = String(form.get("theme_color") || "").trim();
    if (theme && !validAccent(theme)) return c.text("作品颜色请填写 #RRGGBB 格式。", 400);
    const title = String(form.get("title") ?? "").trim();
    const versionNames = form.getAll("edition_name").map((v) => String(v).trim());
    const versionYears = form.getAll("edition_year").map((v) => String(v).trim());
    if (
      versionNames.length > 30 ||
      versionYears.length !== versionNames.length ||
      versionNames.some((n, i) => !n || n.length > 80 || !/^\d{4}$/.test(versionYears[i]))
    )
      return c.text("请为每个版本填写名称与四位年份。", 400);
    if (new Set(versionNames.map((n, i) => versionYears[i] + ":" + n)).size !== versionNames.length)
      return c.text("同一年不能重复添加同名版本。", 400);
    const yearText = String(form.get("year") ?? "").trim();
    const year = yearText ? Number(yearText) : null;
    const resourceIds = selectedResourceIds(form);
    if (
      !title ||
      !resourceIds ||
      title.length > 100 ||
      (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
    )
      return c.text("请检查作品名称和年份。", 400);
    if (!(await selectedResourcesAllowed(c.env.DB, resourceIds, null)))
      return c.text("选择的资料已被其他作品使用。", 409);
    const insert = c.env.DB.prepare(
      "INSERT INTO production(title,synopsis,promo,year,cover_ratio,feature_layout,theme_color,is_hidden) VALUES(?,?,?,?,?,?,?,?)",
    ).bind(
      title,
      String(form.get("synopsis") ?? "").trim(),
      String(form.get("promo") ?? "")
        .trim()
        .slice(0, 300),
      year,
      form.get("cover_ratio") === "portrait" ? "portrait" : "landscape",
      form.get("feature_layout") === "overlay" ? "overlay" : "split",
      theme,
      hidden ?? 0,
    );
    const statements = [insert];
    if (versionNames.length)
      statements.push(
        c.env.DB.prepare("UPDATE production_edition SET name=?,year=? WHERE production_id=last_insert_rowid()").bind(
          versionNames[0],
          Number(versionYears[0]),
        ),
      );
    if (resourceIds.length)
      statements.push(
        c.env.DB.prepare(
          "UPDATE resource SET production_id=last_insert_rowid() WHERE id IN (SELECT value FROM json_each(?)) AND status IN ('pending','approved') AND production_id IS NULL",
        ).bind(JSON.stringify(resourceIds)),
      );
    if (versionNames.length > 1)
      statements.push(
        c.env.DB.prepare(
          `WITH target AS MATERIALIZED (SELECT last_insert_rowid() id)
    INSERT INTO production_edition(production_id,name,year) SELECT target.id,json_extract(j.value,'$.name'),json_extract(j.value,'$.year') FROM target,json_each(?) j`,
        ).bind(JSON.stringify(versionNames.slice(1).map((name, i) => ({ name, year: Number(versionYears[i + 1]) })))),
      );
    const results = await c.env.DB.batch(statements);
    const productionId = Number(results[0].meta.last_row_id);
    return c.redirect(`/productions/${productionId}`, 303);
  });

  productionRoutes.get("/admin/productions/:id/edit", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    const production = await c.env.DB.prepare(
      "SELECT id,title,synopsis,promo,year,cover_id,cover_ratio,feature_layout,theme_color,is_hidden FROM production WHERE id=?",
    )
      .bind(id)
      .first<ProductionRow>();
    if (!production) return c.text("未找到这部作品。", 404);
    const covers = await c.env.DB.prepare(
      "SELECT id,title FROM resource WHERE production_id=? AND status='approved' AND res_type='photo' ORDER BY id DESC",
    )
      .bind(id)
      .all<{ id: number; title: string }>();
    return c.html(
      productionFormPage(production, await csrfFor(c), covers.results, await resourceChoices(c.env.DB, id)),
    );
  });

  productionRoutes.post("/admin/productions/:id/edit", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    const hidden = hiddenValue(form);
    if (Number.isNaN(hidden)) return c.text("可见性无效。", 400);
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const theme = form.has("theme_color") ? String(form.get("theme_color") || "").trim() : null;
    if (theme && !validAccent(theme)) return c.text("作品颜色请填写 #RRGGBB 格式。", 400);
    const id = Number(c.req.param("id"));
    const title = String(form.get("title") ?? "").trim();
    const yearText = String(form.get("year") ?? "").trim();
    const year = yearText ? Number(yearText) : null;
    const resourceIds = selectedResourceIds(form);
    if (
      !title ||
      !resourceIds ||
      title.length > 100 ||
      (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999))
    )
      return c.text("请检查作品名称和年份。", 400);
    const coverText = String(form.get("cover_id") ?? "");
    const cover = coverText ? Number(coverText) : null;
    if (cover !== null && !resourceIds.includes(cover)) return c.text("作品封面必须同时保留在关联资料中。", 400);
    const outcome = await saveProduction(c.env.DB, {
      id,
      title,
      synopsis: String(form.get("synopsis") ?? "").trim(),
      promo: String(form.get("promo") ?? "")
        .trim()
        .slice(0, 300),
      year,
      coverRatio: form.get("cover_ratio") === "portrait" ? "portrait" : "landscape",
      featureLayout: form.get("feature_layout") === "overlay" ? "overlay" : "split",
      cover,
      theme,
      hidden,
      resourceIds,
    });
    if (outcome === "missing") return c.text("未找到这部作品。", 404);
    if (outcome === "conflict") return c.text("选择的资料已被其他作品使用。", 409);
    if (outcome === "cover") return c.text("封面必须选择该作品已审核的剧照。", 400);
    await invalidateSiteProfile(c);
    return c.redirect(`/productions/${id}`, 303);
  });

  productionRoutes.post("/admin/productions/:id/delete", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    const id = Number(c.req.param("id"));
    const production = await c.env.DB.prepare("SELECT title FROM production WHERE id=?")
      .bind(id)
      .first<{ title: string }>();
    if (!production) return c.text("未找到这部作品。", 404);
    if (String(form.get("confirm_title") ?? "").trim() !== production.title)
      return c.text("作品名不一致，未执行删除。", 400);
    await c.env.DB.prepare("DELETE FROM production WHERE id=?").bind(id).run();
    return c.redirect("/productions?deleted=1", 303);
  });
}
