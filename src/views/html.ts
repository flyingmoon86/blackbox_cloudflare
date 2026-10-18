import { escapeHtml } from "../shared/html";
export { escapeHtml } from "../shared/html";

export function message(text: string, kind = "alert"): string {
  return text ? `<p class="${kind}" role="status">${escapeHtml(text)}</p>` : "";
}
