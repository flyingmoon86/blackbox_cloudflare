import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { creditFixture } from "./backend/credit-import-fixture.mjs";
import { context } from "./backend/harness.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright"
);
const modelPath = resolve(
  process.env.THREE_D_MODEL_PATH || "artifacts/archive/releases/2026-11-06-three-d-archive/scene-03.compressed.ply",
);
const coverPath = resolve(
  process.env.THREE_D_COVER_PATH || "artifacts/archive/releases/2026-11-06-three-d-archive/scene-3.jpg",
);
const evidenceDir = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-06-three-d-admin/browser");
mkdirSync(evidenceDir, { recursive: true });
const evidence = {
  scope: "Local Worker with synthetic accounts, in-memory D1, mock R2 and a real compressed PLY",
  checks: [],
};
const fixture = await creditFixture();
const assetRoot = resolve("public");
const mimeTypes = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
fixture.env.ASSETS.fetch = async (request) => {
  const pathname = decodeURIComponent(new URL(request.url).pathname);
  const path = resolve(assetRoot, "." + pathname);
  if (!path.startsWith(assetRoot + sep)) return new Response("", { status: 404 });
  try {
    return new Response(readFileSync(path), {
      headers: { "Content-Type": mimeTypes[extname(path)] || "application/octet-stream" },
    });
  } catch {
    return new Response("", { status: 404 });
  }
};

const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await fixture.worker.fetch(
      new Request("http://127.0.0.1:" + server.address().port + req.url, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
      }),
      fixture.env,
      context(),
    );
    const headers = Object.fromEntries(response.headers);
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) headers["set-cookie"] = setCookies;
    res.writeHead(response.status, headers);
    if (response.body) await pipeline(Readable.fromWeb(response.body), res);
    else res.end();
  } catch (error) {
    console.error(error);
    if (res.headersSent) res.destroy(error);
    else res.writeHead(500).end("Synthetic fixture error");
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = "http://127.0.0.1:" + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    channel: "msedge",
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const admin = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: "reduce" });
  await admin.addCookies(
    fixture.cookies[1].split("; ").map((pair) => {
      const index = pair.indexOf("=");
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: base };
    }),
  );
  const page = await admin.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const title = "三维档案浏览器验收";
  await page.goto(base + "/admin/three-d");
  await page.getByRole("link", { name: "新建场景" }).click();
  await page.locator("[name=title]").fill(title);
  await page.locator("[name=description]").fill("验证后台建档、续传、预览与发布。");
  await page.locator("[name=production_id]").selectOption("10");
  await page.locator("[name=edition_id]").selectOption("30");
  await page.getByRole("button", { name: "保存草稿并继续" }).click();
  await page.waitForURL(/\/admin\/three-d\/[a-z0-9-]+\?result=created/);
  const editPath = new URL(page.url()).pathname;
  const sceneId = editPath.split("/").at(-1);

  let failedParts = 0;
  let startedTasks = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/uploads")) startedTasks++;
  });
  await page.route("**/api/admin/3d/scenes/*/uploads/*/parts/*", (route) => {
    if (failedParts >= 3) return route.continue();
    failedParts++;
    return route.fulfill({ status: 503, json: { error: "合成网络中断" } });
  });
  await page.locator("[name=model]").setInputFiles(modelPath);
  await page.getByRole("button", { name: "上传模型", exact: true }).click();
  await page.getByText("合成网络中断", { exact: true }).waitFor();
  await page.reload();
  await page.locator("[name=model]").setInputFiles(modelPath);
  await page.getByRole("button", { name: "继续上传模型" }).click();
  await page.getByText(/待发布 · .*\.ply/).waitFor({ timeout: 60000 });
  assert.equal(startedTasks, 1, "refresh should resume the existing upload");
  await page.locator("[name=cover]").setInputFiles(coverPath);
  await page.getByRole("button", { name: "上传封面" }).click();
  await page.getByText("待发布 · cover.jpg").waitFor({ timeout: 30000 });
  await page.screenshot({ path: resolve(evidenceDir, "admin-edit.png") });
  await page.locator("[data-three-d-upload]").screenshot({ path: resolve(evidenceDir, "admin-upload.png") });
  evidence.checks.push("Admin created a draft; model upload resumed after failed requests and refresh; cover staged");

  const guest = await browser.newContext({
    viewport: { width: 390, height: 760 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const publicModelPath = "/3d/scenes/" + sceneId + "/model";
  assert.equal((await guest.request.get(base + publicModelPath)).status(), 404);
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: /预览场景/ }).click();
  const preview = await popup;
  await preview.getByRole("button", { name: /打开三维场景/ }).click();
  await preview.waitForFunction(() => document.querySelector('[data-splat-action="reset"]')?.disabled === false, null, {
    timeout: 90000,
  });
  await preview.waitForTimeout(1700);
  const desktopCanvas = await preview.locator(".splat-viewport").boundingBox();
  assert(desktopCanvas.width >= 1366 * 0.95 && desktopCanvas.height >= 768 * 0.95);
  await preview.getByRole("button", { name: "帮助", exact: true }).click();
  assert(await preview.locator("#splat-help").isVisible());
  await preview.getByRole("button", { name: "帮助", exact: true }).click();
  assert(await preview.locator("#splat-help").isHidden());
  await preview.screenshot({ path: resolve(evidenceDir, "admin-model-preview.png") });
  await preview.close();
  evidence.checks.push("Admin preview rendered the real compressed PLY; draft model was unavailable to guests");

  await page.getByRole("button", { name: "发布场景", exact: true }).click();
  await page.waitForURL(/result=published/);
  const publicPage = await guest.newPage();
  const requestedModels = [];
  publicPage.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/model")) requestedModels.push(request.url());
  });
  await publicPage.goto(base + "/3d");
  const publicCard = publicPage.locator(".splat-card").filter({ hasText: title });
  await publicCard.waitFor();
  await publicCard.hover();
  await publicPage.waitForTimeout(1000);
  assert.equal(requestedModels.length, 0);
  assert.equal(await publicPage.locator(".splat-viewport canvas").count(), 0);
  assert.equal(
    await publicPage.evaluate(
      () =>
        performance.getEntriesByType("resource").filter((entry) => entry.name.includes("/three-d-engine.js")).length,
    ),
    0,
  );
  await publicCard.getByRole("button", { name: /打开三维场景/ }).click();
  await publicPage.waitForFunction(
    () => document.querySelector('[data-splat-action="reset"]')?.disabled === false,
    null,
    { timeout: 90000 },
  );
  assert.equal(requestedModels.length, 1);
  await publicPage.waitForTimeout(1700);
  const mobileCanvas = await publicPage.locator(".splat-viewport").boundingBox();
  assert(mobileCanvas.width >= 388 && mobileCanvas.height >= 758);
  const mobileTools = await publicPage.locator(".splat-tools").boundingBox();
  assert(mobileTools.x >= 0 && mobileTools.x + mobileTools.width <= 390);
  await publicPage.screenshot({ path: resolve(evidenceDir, "public-mobile-model.png") });
  await publicPage.getByRole("button", { name: /关闭/ }).click();
  await publicPage.locator(".splat-viewport canvas").waitFor({ state: "detached" });
  evidence.checks.push(
    "Desktop canvas fills 95% of each viewport dimension; mobile canvas fills viewport; help toggles; no model, engine or canvas before click, including hover; closing removes canvas",
  );
  const modelHead = await guest.request.head(base + publicModelPath);
  assert.equal(modelHead.status(), 200);
  evidence.checks.push("Published model rendered for a guest at mobile dimensions and loaded only on click");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "下架场景" }).click();
  await page.waitForURL(/result=archived/);
  assert.equal((await guest.request.head(base + publicModelPath)).status(), 404);
  assert.deepEqual(errors, []);
  evidence.checks.push("Admin archived the scene and guest HEAD was denied");

  const mobileAdmin = await browser.newContext({
    viewport: { width: 390, height: 760 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  await mobileAdmin.addCookies(await admin.cookies());
  const mobileEdit = await mobileAdmin.newPage();
  await mobileEdit.goto(base + editPath);
  await mobileEdit.getByRole("heading", { name: "编辑三维场景" }).waitFor();
  const mobileForm = await mobileEdit.locator("[data-three-d-metadata]").boundingBox();
  assert(
    mobileForm.x >= 0 && mobileForm.x + mobileForm.width <= 390,
    "admin form must stay within the mobile viewport",
  );
  await mobileEdit.screenshot({ path: resolve(evidenceDir, "admin-mobile-edit.png") });
  await mobileAdmin.close();
  evidence.checks.push("Admin edit form fits a mobile viewport");
  console.log(evidence.checks.join("\n"));
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  fixture.db.close();
  writeFileSync(resolve(evidenceDir, "verification.json"), JSON.stringify(evidence, null, 2) + "\n");
}
