export const IMPORT_SCHEMA = {
  version: 1,
  sheet: "演职人员导入",
  guide: "填写说明",
  maxRows: 50,
  maxBytes: 5 * 1024 * 1024,
  maxExpandedBytes: 8 * 1024 * 1024,
  fields: [
    { key: "member_name", title: "*姓名", max: 50, required: true, example: "张三" },
    { key: "external_id", title: "外部ID", max: 80, required: false, example: "BB-M-0001" },
    { key: "kind", title: "*类别", max: 20, required: true, example: "演员" },
    { key: "role_name", title: "*角色或分工", max: 80, required: true, example: "哈姆雷特" },
  ],
  kinds: { 演员: "cast", 后台与创作: "crew" } as Record<string, string>,
} as const;

export class ImportError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}
export type ImportRow = {
  id?: number;
  row_number: number;
  person_key: string;
  member_name: string;
  external_id: string | null;
  kind: string;
  role_name: string;
  input_error: string;
  choice: "auto" | "match" | "create" | "skip";
  matched_member_id: number | null;
  resolution: "matched" | "create" | "skip" | "error" | "unresolved";
  error_code: string;
  error_message: string;
  generated_external_id: string | null;
  expected_member_revision: number | null;
  created_credit_id?: number | null;
  expected_credit_id?: number | null;
  outcome?: string;
};
export type ImportBatch = {
  id: string;
  production_id: number | null;
  edition_id: number | null;
  actor_id: number | null;
  actor_name: string;
  production_title: string;
  edition_label: string;
  template_version: number;
  original_name: string;
  file_sha256: string;
  status: string;
  total_rows: number;
  add_count: number;
  skip_count: number;
  error_count: number;
  create_member_count: number;
  created_at: string;
  updated_at: string;
  committed_at: string | null;
  rolled_back_at: string | null;
  revision: number;
  details_purged: number;
};
export type MemberMatch = {
  id: number;
  name: string;
  cohort: string;
  external_id: string | null;
  import_revision: number;
};
export type ImportTarget = { id: number; title: string; edition_id: number; edition_name: string; year: number | null };
// SQLite NOCASE folds ASCII, so matching and duplicate keys use the same rule.
export const identityKey = (value: string) => value.trim().replace(/[A-Z]/g, (s) => s.toLowerCase());
export const personKey = (name: string, external: string | null) =>
  external ? "id:" + identityKey(external) : "name:" + identityKey(name);
export function csv(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export const templateCsv = () =>
  csv([IMPORT_SCHEMA.fields.map((f) => f.title), IMPORT_SCHEMA.fields.map((f) => f.example)]);
