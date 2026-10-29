import { mkdirSync, writeFileSync } from "node:fs";
import { loadModule } from "./backend/harness.mjs";
const { handbook } = await loadModule("src/content/member-handbook.ts");
mkdirSync("artifacts/working/handbook", { recursive: true });
writeFileSync("artifacts/working/handbook/content.json", JSON.stringify(handbook));
