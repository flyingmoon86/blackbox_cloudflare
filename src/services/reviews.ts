import { HTTPException } from "hono/http-exception";
import type { Bindings } from "../types";
const tables = { member: "join_request", "production-join": "production_join_request", resource: "resource" } as const;
export async function reviewRequest(
  db: Bindings["DB"],
  kind: keyof typeof tables,
  id: number,
  actorId: number,
  decision: "approved" | "rejected",
  note = "",
) {
  if (!Number.isSafeInteger(id) || id < 1) throw new HTTPException(400, { message: "申请编号无效。" });
  if (note.length > 1000 || (decision === "rejected" && !note.trim()))
    throw new HTTPException(400, { message: "请填写 1–1000 字的驳回理由。" });
  try {
    const result = await db
      .prepare(
        `UPDATE ${tables[kind]} SET status=?,admin_note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM user WHERE id=? AND role='admin' AND status='active') RETURNING id`,
      )
      .bind(decision, note, actorId, id, actorId)
      .first<{ id: number }>();
    if (!result) throw new HTTPException(409, { message: "申请不存在或已被处理，请刷新查看结果。" });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const message = String(error);
    if (/review_applicant_changed|review_member_unavailable|UNIQUE constraint failed/.test(message))
      throw new HTTPException(409, { message: "账号、档案或审核状态已变化，请刷新后重试。" });
    throw error;
  }
}
