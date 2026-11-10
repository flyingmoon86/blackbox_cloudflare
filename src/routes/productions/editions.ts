import { Hono } from "hono";
import { csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import type { EditionRow } from "../../services/productions/types";
import { selectedEdition } from "../../services/productions/queries";
import { selectedResourceIds } from "../../services/productions/forms";
import { adminOnly } from "../../http/authorization";

export function registerEditionsRoutes(productionRoutes: Hono<AppEnv>) {
  productionRoutes.post("/admin/productions/:id/editions", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
    const productionId = Number(c.req.param("id")),
      name = String(form.get("name") || "").trim(),
      year = Number(form.get("year"));
    if (!name || name.length > 80 || !Number.isInteger(year) || year < 1 || year > 9999)
      return c.text("请填写版本名称和年份。", 400);
    if (!(await c.env.DB.prepare("SELECT id FROM production WHERE id=?").bind(productionId).first()))
      return c.notFound();
    try {
      await c.env.DB.prepare("INSERT INTO production_edition(production_id,name,year,description) VALUES(?,?,?,?)")
        .bind(
          productionId,
          name,
          year,
          String(form.get("description") || "")
            .trim()
            .slice(0, 10000),
        )
        .run();
    } catch (error) {
      if (/UNIQUE/.test(String(error))) return c.text("同年已有同名版本。", 409);
      throw error;
    }
    return c.redirect("/productions/" + productionId, 303);
  });

  productionRoutes.post("/admin/productions/:id/move-resources", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
    const production = Number(c.req.param("id")),
      edition = await selectedEdition(c.env.DB, form, production);
    const ids = selectedResourceIds(form);
    if (!edition || !ids?.length || ids.length > 100) return c.text("请选择目标版本和最多 100 份资料。", 400);
    const encoded = JSON.stringify(ids);
    const result = await c.env.DB.prepare(
      "UPDATE resource SET edition_id=? WHERE production_id=? AND id IN (SELECT value FROM json_each(?)) AND (SELECT COUNT(*) FROM resource WHERE production_id=? AND id IN (SELECT value FROM json_each(?)))=?",
    )
      .bind(edition, production, encoded, production, encoded, ids.length)
      .run();
    if (result.meta.changes !== ids.length) return c.text("资料归属已变化，本次未移动，请刷新后重试。", 409);
    return c.redirect(`/productions/${production}#edition-${edition}`, 303);
  });

  productionRoutes.post("/admin/productions/:id/editions/:editionId", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效。", 400);
    const productionId = Number(c.req.param("id")),
      editionId = Number(c.req.param("editionId"));
    const name = String(form.get("name") || "").trim(),
      yearText = String(form.get("year") || "").trim();
    const previous = await c.env.DB.prepare("SELECT * FROM production_edition WHERE id=? AND production_id=?")
      .bind(editionId, productionId)
      .first<EditionRow>();
    if (!previous) return c.notFound();
    const field = (key: string, old: string | number | null | undefined) =>
      form.has(key) ? String(form.get(key) ?? "").trim() : String(old ?? "");
    const keywords = field("creative_keywords", previous.creative_keywords)
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const place = field("rehearsal_place", previous.rehearsal_place);
    const story = field("backstage_story", previous.backstage_story);
    const minutes = field("duration_minutes", previous.duration_minutes);
    if (
      keywords.length > 5 ||
      keywords.some((s) => s.length > 20) ||
      place.length > 100 ||
      story.length > 1000 ||
      (minutes && (!/^\d+$/.test(minutes) || !Number.isSafeInteger(Number(minutes)) || Number(minutes) < 1))
    )
      return c.text(
        "请检查幕后信息：关键词最多 5 个且每个 20 字，地点最多 100 字，故事最多 1000 字，时长为正整数分钟。",
        400,
      );
    const year = yearText ? Number(yearText) : previous.year;
    if (!name || name.length > 80 || (year !== null && (!Number.isInteger(year) || year < 1 || year > 9999)))
      return c.text("请检查版本名称和年份。", 400);
    try {
      const result = await c.env.DB.prepare(
        "UPDATE production_edition SET name=?,year=?,description=?,creative_keywords=?,rehearsal_place=?,duration_minutes=?,backstage_story=? WHERE id=? AND production_id=?",
      )
        .bind(
          name,
          year,
          String(form.get("description") || "")
            .trim()
            .slice(0, 10000),
          keywords.join("、") || null,
          place || null,
          minutes ? Number(minutes) : null,
          story || null,
          editionId,
          productionId,
        )
        .run();
      if (!result.meta.changes) return c.notFound();
    } catch (error) {
      if (/UNIQUE/.test(String(error))) return c.text("同年已有同名版本。", 409);
      throw error;
    }
    return c.redirect(`/productions/${productionId}#edition-${editionId}`, 303);
  });
}
