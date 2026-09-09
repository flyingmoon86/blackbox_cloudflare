export type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  R2_BUCKET_NAME?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
};

export type UserSession = {
  id: number;
  username: string;
  auth_version: number;
  role: "user" | "member" | "admin";
  status: "active" | "disabled";
  email: string | null;
  pending_email: string | null;
  member_id: number | null;
};

export type AccountRow = UserSession & { password_hash: string };

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: UserSession | null };
};
