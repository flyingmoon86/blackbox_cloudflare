export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
};

export type UserSession = {
  id: number;
  username: string;
  auth_version: number;
  role: "user" | "member" | "admin";
  status: "active" | "disabled";
  email: string | null;
  pending_email: string | null;
};

export type AccountRow = UserSession & { password_hash: string };

export type AppEnv = {
  Bindings: Bindings;
  Variables: { user: UserSession | null };
};
