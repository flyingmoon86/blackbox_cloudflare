import { HTTPException } from "hono/http-exception";
import type { UserSession } from "../types";

export const DESTINATIONS = {
  recommendation: "保研",
  exam: "考研",
  overseas: "出国/境深造",
  employment: "就业",
  entrepreneurship: "创业",
  other: "其他",
  undecided: "暂未确定",
} as const;
export const KNOWLEDGE = { unfilled: "未填写", unknown: "未知", provided: "已提供", refused: "不愿提供" } as const;
export const DETAIL_LABELS = {
  undergraduate: "本科院校 / 院系 / 专业（可选）",
  graduate: "研究生院校",
  doctoral: "博士院校",
  employer: "工作单位",
  supplement: "学院 / 专业 / 岗位（可选）",
  source: "信息来源（仅本人和管理员可见）",
  notes: "备注（仅本人和管理员可见）",
} as const;
// Field names are shared by the form and server; hidden/inapplicable inputs are ignored.
export const DESTINATION_FIELDS: Record<keyof typeof DESTINATIONS, Record<string, string>> = {
  recommendation: { graduate: "学校", supplement: "专业" },
  exam: { graduate: "学校", supplement: "专业" },
  overseas: { graduate: "学校", supplement: "国家 / 地区、专业" },
  employment: { employer: "工作单位", supplement: "岗位" },
  entrepreneurship: { employer: "项目 / 团队", supplement: "方向" },
  other: { notes: "想补充的话" },
  undecided: {},
};
export function parseDestination(form: FormData, previous?: MemberRecord) {
  const read = (key: string, max: number) => {
    const value = form.get(key);
    if (value !== null && typeof value !== "string") throw new HTTPException(400, { message: "填写内容格式不正确。" });
    const text = (value || "").trim();
    if (text.length > max) throw new HTTPException(400, { message: "填写内容太长了，请缩短后保存。" });
    return text;
  };
  const year = read("graduation_year", 4),
    type = read("destination_type", 30);
  if (year && !/^(19|20|21)\d{2}$/.test(year)) throw new HTTPException(400, { message: "毕业年份请填四位数字。" });
  if (!Object.hasOwn(DESTINATIONS, type)) throw new HTTPException(400, { message: "请选择去向。" });
  const previousDetails: Partial<RecordDetails> = previous ? detailsOf(previous) : {};
  const details = Object.fromEntries(
    Object.keys(DETAIL_LABELS).map((key) => [key, previousDetails[key as keyof RecordDetails] || ""]),
  ) as RecordDetails;
  // Keep removed legacy source/undergraduate/doctoral fields intact. A deliberate
  // destination change clears the old type's visible answers; audit keeps old values.
  if (previous && previous.destination_type !== type)
    for (const key of ["graduate", "employer", "supplement", "notes"] as const) details[key] = "";
  for (const key of Object.keys(DESTINATION_FIELDS[type as keyof typeof DESTINATIONS])) {
    // Each type owns its inputs so switching school/job types cannot re-label an
    // old answer. Accept legacy field names from already-open forms as well.
    const name = form.has(`${type}_${key}`) ? `${type}_${key}` : key;
    details[key as keyof RecordDetails] = read(name, key === "notes" ? 2000 : 300);
  }
  return {
    graduation_year: year ? Number(year) : null,
    knowledge: "provided",
    destination_type: type,
    title: "毕业去向",
    event_date: "",
    details: JSON.stringify(details),
  };
}
export type RecordDetails = Record<keyof typeof DETAIL_LABELS, string>;
export type MemberRecord = {
  id: string;
  member_id: number;
  kind: "destination" | "moment";
  graduation_year: number | null;
  knowledge: keyof typeof KNOWLEDGE;
  destination_type: keyof typeof DESTINATIONS | null;
  verified: number;
  checked_at: string | null;
  title: string;
  event_date: string;
  details: string;
  audience: "admins" | "members";
  consent_by: number | null;
  archived: number;
  version: number;
  updated_by: number;
  updated_at: string;
  action: string;
};
export const certified = (user: UserSession | null): boolean =>
  Boolean(user && user.status === "active" && (user.role === "admin" || (user.role === "member" && user.member_id)));
export const canMaintain = (user: UserSession, memberId: number): boolean =>
  user.role === "admin" || (user.role === "member" && user.member_id === memberId);
export function detailsOf(record: MemberRecord): RecordDetails {
  return JSON.parse(record.details);
}
export const STATISTICS_NOTE = "保研率 = 保研人数 ÷ 已填写且去向确定的人数。暂未确定和未填写不计入分母。";
export async function recordStatistics(db: D1Database, year?: number) {
  const rows = await db
    .prepare(
      `SELECT graduation_year,COUNT(*) total,
    SUM(knowledge='unfilled') unfilled,SUM(knowledge='unknown') unknown,SUM(knowledge='refused') refused,
    SUM(knowledge<>'provided') unreported,
    SUM(knowledge='provided' AND destination_type<>'undecided') denominator,
    SUM(knowledge='provided' AND destination_type='recommendation') numerator,
    ${Object.keys(DESTINATIONS)
      .map((key) => `SUM(knowledge='provided' AND destination_type='${key}') ${key}`)
      .join(",")}
    FROM member_record WHERE kind='destination' AND archived=0 ${year ? "AND graduation_year=?" : ""} GROUP BY graduation_year ORDER BY graduation_year DESC`,
    )
    .bind(...(year ? [year] : []))
    .all<Record<string, number | null>>();
  const missing = await db
    .prepare(
      "SELECT COUNT(*) n FROM member m WHERE NOT EXISTS(SELECT 1 FROM member_record r WHERE r.member_id=m.id AND r.kind='destination' AND r.archived=0)",
    )
    .first<{ n: number }>();
  return { rows: rows.results, missing: missing?.n || 0 };
}
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Guard spreadsheet formulas even when preceded by whitespace/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
