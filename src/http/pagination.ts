export type AdminPage = {
  page: number;
  size: number;
  total: number;
  path: string;
  params: Record<string, string>;
  pageKey: string;
};

export function adminPage(
  total: number,
  requested: string | undefined,
  path: string,
  params: Record<string, string> = {},
  size = 24,
  pageKey = "page",
): AdminPage {
  const page = requested && /^[1-9]\d{0,6}$/.test(requested) ? Number(requested) : 1;
  return { total, page: Math.min(page, Math.max(1, Math.ceil(total / size))), size, path, params, pageKey };
}

export function adminPageUrl(info: AdminPage, page = info.page): string {
  const params = new URLSearchParams(info.params);
  for (const [key, value] of [...params]) if (!value) params.delete(key);
  params.set(info.pageKey, String(page));
  return info.path + "?" + params;
}

/** Never let a list's return link redirect to another origin or route. */
export function safeListReturn(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith(path + "?")) return path;
  try {
    const url = new URL(value, "https://list.invalid");
    return url.origin === "https://list.invalid" && url.pathname === path ? url.pathname + url.search : path;
  } catch {
    return path;
  }
}

export function searchTerm(value: string | undefined): string {
  return (value || "").trim().slice(0, 100);
}

export function likeTerm(value: string): string {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export function filterChoice(value: string | undefined, choices: string[]): string {
  return choices.includes(value || "") ? value! : "";
}
