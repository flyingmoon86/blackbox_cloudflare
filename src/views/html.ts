export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function message(text: string, kind = "alert"): string {
  return text ? `<p class="${kind}" role="status">${escapeHtml(text)}</p>` : "";
}
