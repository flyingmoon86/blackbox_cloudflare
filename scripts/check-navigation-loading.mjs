// Compatibility entry for the removed editorial loading implementation.
// Historic --serve-delay fixtures are obsolete; current checks own isolated delays.
if (process.argv.includes("--serve-delay"))
  throw new Error("Use node scripts/check-curtain-navigation.mjs for slow-navigation fixtures.");
await import("./check-curtain-navigation.mjs");
