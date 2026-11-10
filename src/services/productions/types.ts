export type ProductionRow = {
  is_hidden?: number;
  featured?: number;
  edition_count?: number;
  theme_color?: string;
  id: number;
  title: string;
  synopsis: string;
  promo: string;
  year: number | null;
  cover_id: number | null;
  cover_ratio: string;
  feature_layout: string;
};
export type CreditRow = {
  edition_id?: number | null;
  id: number;
  member_id: number;
  member_name: string;
  kind: "cast" | "crew";
  role_name: string;
};
export type MemberChoice = { id: number; name: string; cohort: string };
export type EditionRow = {
  id: number;
  production_id: number;
  name: string;
  year: number | null;
  description: string;
  creative_keywords?: string | null;
  rehearsal_place?: string | null;
  duration_minutes?: number | null;
  backstage_story?: string | null;
};
export type ProductionResourceRow = {
  edition_id?: number | null;
  id: number;
  title: string;
  res_type: string;
  description: string;
  original_name: string;
  preview_filename: string;
};
export type ResourceChoice = {
  original_name: string;
  preview_filename: string;
  id: number;
  title: string;
  res_type: string;
  status: "pending" | "approved";
  production_id: number | null;
};
export type ProductionJoinRequestRow = {
  edition_name?: string;
  id: number;
  user_id: number;
  username: string;
  member_id: number;
  member_name: string;
  production_id: number;
  production_title: string;
  kind: "cast" | "crew";
  role_name: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string;
  created_at: string;
  existing_names: string;
};
