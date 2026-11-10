export type MemberRow = {
  featured_photos?: Array<{ id: string; caption: string }>;
  flower_senders?: Array<{ name: string; member_id: number | null; amount: number }>;
  anonymous_flowers?: number;
  productions?: Array<{
    id: number;
    title: string;
    edition_id?: number;
    edition_name?: string;
    year?: number | null;
    role_name?: string;
    kind?: string;
  }>;
  id: number;
  name: string;
  bio: string;
  join_year: number | null;
  cohort: string;
  works: string;
  photo: string;
  flower_count: number;
  contributor?: number;
};
