import { createStatisticsFixture, statisticsOrigins } from "./archive-statistics-fixture.mjs";

const { mf } = await createStatisticsFixture({ preview: true, bulk: true });
await mf.ready;
console.log("Disposable synthetic preview: " + statisticsOrigins.admin + "/__fixture/admin");
console.log("Statistics page: " + statisticsOrigins.admin + "/admin/archive-statistics");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await mf.dispose();
    process.exit(0);
  });
