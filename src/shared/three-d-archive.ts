import type { Bindings } from "../types";

export function threeDArchiveEnabled(env: Bindings): boolean {
  return env.ENVIRONMENT === "development" || env.THREE_D_ARCHIVE_ENABLED === "true";
}

export function isThreeDPreviewPath(path: string): boolean {
  return /^\/admin\/three-d\/[a-z0-9-]+\/preview$/.test(path);
}
