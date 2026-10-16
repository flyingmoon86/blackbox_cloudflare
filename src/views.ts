// Compatibility exports for existing route consumers. New views import their
// page shell and HTML helpers directly to keep dependencies one-way.
export { escapeHtml } from "./views/html";
export { layout } from "./views/layout";
export * from "./views/account";
export * from "./views/members";
