// Shared by bundling and development watching so generated scripts never
// trigger their own rebuilds.
export const clientEntries = ["curtain-boot", "navigation-preload", "work-browse"];
export const generatedBrowserScripts = new Set(["system-scene.js", ...clientEntries.map((name) => `${name}.js`)]);
