import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(
  "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/x.js",
);
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 2000 }, deviceScaleFactor: 1.5 });
mkdirSync("public/images/handbook", { recursive: true });
const cases = [
  ["account", "/profile/member-application?role=user", ".card.auth"],
  ["profile", "/profile/member?role=member", ".card.auth"],
  ["photos", "/profile/members/1/photos?role=member", ".photo-manager"],
  ["graduation", "/graduation/1?role=member", ".member-records"],
  ["credits", "/productions/1?role=member", "#join-production"],
  ["upload", "/resources/submit?role=member", ".card.auth"],
  ["help", "/feedback?role=member", ".card.auth"],
  ["admin", "/admin?role=admin", ".workspace-content"],
];
for (const [id, path, selector] of cases) {
  await page.goto("http://127.0.0.1:8794" + path);
  await page.evaluate(() => document.fonts.ready);
  if (id === "graduation") {
    await page.locator("[name=graduation_year]").fill("2027");
    await page.locator("[value=undecided]").check();
  }
  if (id === "profile") await page.locator("[name=bio]").fill("热爱舞台，也喜欢记录排练中的点滴。（示例）");
  if (id === "upload") {
    await page.locator("[name=title]").fill("示例演出 · 排练剧照");
    await page.locator("[name=production_id]").selectOption("1");
    const options = await page
      .locator("[name=edition_id] option")
      .evaluateAll((nodes) => nodes.map((n) => n.value).filter(Boolean));
    if (options.length) await page.locator("[name=edition_id]").selectOption(options[0]);
  }
  if (id === "credits") await page.locator("[name=role_name]").fill("旁白（示例）");
  let target = page.locator(selector).first();
  if (id === "admin") target = page.locator("section").filter({ hasText: "当前待办已清空" }).last();
  if (!(await target.count())) target = page.locator("main");
  await target.screenshot({ path: `public/images/handbook/${id}.png` });
  console.log(id, await target.boundingBox());
}
await browser.close();
