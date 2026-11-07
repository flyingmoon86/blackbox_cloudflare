// Shared by bundling and development watching so generated scripts never
// trigger their own rebuilds.
export const clientEntries = [
  "curtain-boot",
  "navigation-preload",
  "work-browse",
  "announcement-editor",
  "three-d-archive",
  "three-d-upload",
];
export const generatedBrowserScripts = new Set([
  "system-scene.js",
  "three-d-engine.js",
  ...clientEntries.map((name) => `${name}.js`),
]);
