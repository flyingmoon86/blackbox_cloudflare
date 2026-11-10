// Shared by bundling and development watching so generated scripts never
// trigger their own rebuilds.
export const clientEntries = [
  "curtain-boot",
  "navigation-preload",
  "work-browse",
  "member-results",
  "admin-notifications",
  "credit-forms",
  "credit-import",
  "announcement-editor",
  "three-d-archive",
  "three-d-upload",
  "upload",
];
export const generatedBrowserScripts = new Set([
  "system-scene.js",
  "three-d-engine.js",
  ...clientEntries.map((name) => `${name}.js`),
]);
