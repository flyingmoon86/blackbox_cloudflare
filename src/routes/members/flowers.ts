import { visitorIdentity, publicLimit } from "../../services/visitors";
import { Hono } from "hono";
import { csrfValid } from "../../http/cookies";
import type { AppEnv } from "../../types";
import { memberFilter, memberContextQuery } from "../../services/members/queries";
import { pageNumber } from "../../views/shared";

export function registerFlowersMemberRoutes(memberRoutes: Hono<AppEnv>) {
  memberRoutes.post("/members/:id/flowers", async (c) => {
    const user = c.get("user")!;
    const id = Number(c.req.param("id"));
    const form = await c.req.formData();
    if (!csrfValid(c, form.get("csrf"))) return c.text("请求已失效，请刷新页面后重试。", 400);
    if (!Number.isInteger(id) || !(await c.env.DB.prepare("SELECT id FROM member WHERE id = ?").bind(id).first()))
      return c.text("未找到队员档案。", 404);
    const sentOn = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const retry = await publicLimit(c, "flower", 40);
    if (retry) {
      c.header("Retry-After", String(retry));
      return c.text("送花次数较多，请稍后再来。", 429);
    }
    const result = user
      ? await c.env.DB.prepare("INSERT OR IGNORE INTO flower(user_id,member_id,sent_on) VALUES(?,?,?)")
          .bind(user.id, id, sentOn)
          .run()
      : await c.env.DB.prepare("INSERT OR IGNORE INTO visitor_flower(visitor_key,member_id,sent_on) VALUES(?,?,?)")
          .bind(await visitorIdentity(c), id, sentOn)
          .run();
    const query = memberContextQuery(
      memberFilter(c),
      c.req.query("page") ? pageNumber(c.req.query("page")) : undefined,
    );
    query.set("flower", result.meta.changes === 1 ? "sent" : "already");
    return c.redirect(`/members/${id}?${query}`, 303);
  });
}
