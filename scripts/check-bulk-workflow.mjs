import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { creditFixture } from "./backend/credit-import-fixture.mjs";
import { context } from "./backend/harness.mjs";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const out = resolve(process.env.EVIDENCE_DIR || "artifacts/working/2026-11-04-bulk-workflow/browser");
mkdirSync(out, { recursive: true });
const s = await creditFixture();
const root = resolve("public");
s.env.ASSETS.fetch = async (req) => {
  const p = resolve(root, "." + new URL(req.url).pathname);
  if (!p.startsWith(root + sep)) return new Response("", { status: 404 });
  try {
    return new Response(readFileSync(p), {
      headers: {
        "Content-Type":
          {
            ".css": "text/css",
            ".js": "application/javascript",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".webp": "image/webp",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
          }[extname(p)] || "application/octet-stream",
      },
    });
  } catch {
    return new Response("", { status: 404 });
  }
};
let failFile = true;
let loseComplete = false;
let loseReview = false;
const server = createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (
      req.method === "POST" &&
      req.url === "/api/uploads" &&
      JSON.parse(body).originalName === "probe-47.png" &&
      failFile
    ) {
      res
        .writeHead(503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "合成测试：第48个文件初始化暂时失败" }));
      return;
    }
    const response = await s.worker.fetch(
      new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method,
        headers: req.headers,
        ...(!["GET", "HEAD"].includes(req.method) ? { body } : {}),
      }),
      s.env,
      context(),
    );
    if (loseComplete && req.method === "POST" && /\/complete$/.test(req.url)) {
      res
        .writeHead(503, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "合成测试：提交成功后丢失响应" }));
      return;
    }
    if (loseReview && req.method === "POST" && /\/review$/.test(req.url)) {
      res.destroy();
      return;
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    res.writeHead(500).end("synthetic probe failure");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const evidence = {
  date: new Date().toISOString(),
  scope: "本机合成账号/内存D1与模拟R2；真实Worker、页面及脚本；注入上传失败、限频及响应丢失；不访问生产",
  checks: [],
};
try {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: "reduce",
    acceptDownloads: true,
    hasTouch: true,
  });
  await ctx.addCookies(
    s.cookies[1].split("; ").map((pair) => {
      const i = pair.indexOf("=");
      return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base };
    }),
  );
  const page = await ctx.newPage();
  const errors = [];
  const uploadRequests = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/uploads/")) uploadRequests.push({ method: r.method(), path });
  });
  const failedRequests = [];
  page.on("pageerror", (e) => errors.push(e.name + ":" + e.message));
  page.on("requestfailed", (r) =>
    failedRequests.push({ path: new URL(r.url()).pathname, error: r.failure()?.errorText }),
  );
  await page.goto(base + "/resources/submit", { waitUntil: "networkidle" });
  await page.locator('[name="production_id"]').selectOption("10");
  await page.locator('[name="edition_id"]').selectOption("30");
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    c.getContext("2d").fillRect(0, 0, 32, 32);
    return c.toDataURL("image/png").split(",")[1];
  });
  const chooseFiles = async (names, target = page) =>
    target.evaluate(
      ({ names, png }) => {
        const bytes = Uint8Array.from(atob(png), (v) => v.charCodeAt(0));
        const dt = new DataTransfer();
        for (const name of names) dt.items.add(new File([bytes], name, { type: "image/png", lastModified: 123456789 }));
        const input = document.querySelector("[name=file]");
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
      { names, png },
    );
  const names = Array.from({ length: 100 }, (_, i) => `probe-${i}.png`);
  await chooseFiles(names);
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#upload-batch-summary")?.textContent.includes("成功 99") &&
      !document.querySelector("#upload-pause").offsetParent,
    {},
    { timeout: 120000 },
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 99);
  await page.reload({ waitUntil: "networkidle" });
  await chooseFiles(names);
  failFile = false;
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#upload-batch-summary")?.textContent.includes("成功 100"),
    {},
    { timeout: 30000 },
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource").get().n, 100);
  assert.equal(
    s.db.prepare("SELECT original_name FROM resource GROUP BY original_name HAVING COUNT(*)>1").all().length,
    0,
  );
  evidence.checks.push({ case: "100文件中第48项失败，刷新并重选全部文件恢复", completed: 100, duplicates: 0 });
  const statusReads = uploadRequests.filter(
    (r) => r.method === "GET" && /^\/api\/uploads\/[^/]+$/.test(r.path) && !r.path.endsWith("/policy"),
  ).length;
  const partUrlRequests = uploadRequests.filter((r) => r.path.endsWith("/url")).length;
  assert.equal(statusReads, 0);
  assert.equal(partUrlRequests, 0);
  evidence.checks.push({
    case: "新建代理上传省去空状态查询与分片地址请求",
    files: 100,
    statusReads,
    partUrlRequests,
    removedRoundTrips: 200,
  });
  await page.locator("#upload-batch").scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + "/upload-results-desktop.png" });
  // Lost completion responses must reuse the server task after retry/reload.
  await page.locator("#upload-new-batch").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch").hidden);
  await chooseFiles(["lost-response.png"]);
  await page.locator("[name=title]").fill("合成响应丢失");
  loseComplete = true;
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector("#upload-batch-summary")?.textContent.includes("失败 1"),
    {},
    { timeout: 30000 },
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE original_name='lost-response.png'").get().n, 1);
  loseComplete = false;
  await page.reload({ waitUntil: "networkidle" });
  await chooseFiles(["lost-response.png"]);
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch-summary")?.textContent.includes("成功 1"));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE original_name='lost-response.png'").get().n, 1);
  evidence.checks.push({ case: "完成写入后响应丢失，刷新再确认", records: 1 });
  // Hold task creation to exercise pause and simultaneous submissions deterministically.
  await page.locator("#upload-new-batch").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch").hidden);
  await chooseFiles(["lock-a.png", "lock-b.png"]);
  let releaseCreation;
  const heldCreation = new Promise((r) => {
    releaseCreation = r;
  });
  let sawCreation;
  const creationSeen = new Promise((r) => {
    sawCreation = r;
  });
  await page.route("**/api/uploads", async (route) => {
    sawCreation();
    await heldCreation;
    await route.continue();
  });
  await page.locator("#resource-upload button[type=submit]").click();
  await creationSeen;
  const other = await ctx.newPage();
  await other.goto(base + "/resources/submit", { waitUntil: "networkidle" });
  await chooseFiles(["lock-a.png", "lock-b.png"], other);
  await other.locator("#resource-upload button[type=submit]").click();
  await other.waitForFunction(() =>
    document.querySelector("#upload-status").textContent.includes("另一个标签页正在处理"),
  );
  await page.locator("#upload-pause").click();
  releaseCreation();
  await page.waitForFunction(
    () =>
      document.querySelector("#upload-batch-summary").textContent.includes("成功 1") &&
      document.querySelector("#upload-pause").hidden,
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE original_name LIKE 'lock-%'").get().n, 1);
  await page.unroute("**/api/uploads");
  await other.locator("#resource-upload button[type=submit]").click();
  await other.waitForFunction(() =>
    document.querySelector("#upload-status").textContent.includes("批次已被另一标签页更新"),
  );
  await other.close();
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch-summary").textContent.includes("成功 2"));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE original_name LIKE 'lock-%'").get().n, 2);
  evidence.checks.push({ case: "同账号两标签页互斥、旧页防重及当前文件完成后暂停", records: 2 });
  // A rate limit stops the batch before any later files are sent.
  await page.locator("#upload-new-batch").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch").hidden);
  await chooseFiles(["limit-a.png", "limit-b.png"]);
  let limitedRequests = 0;
  await page.route("**/api/uploads", (route) => {
    limitedRequests++;
    return route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "Retry-After": "1" },
      body: JSON.stringify({ error: "合成限频" }),
    });
  });
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#upload-batch-summary").textContent.includes("失败 1") &&
      document.querySelector("#upload-pause").hidden,
  );
  assert.equal(limitedRequests, 1);
  await page.unroute("**/api/uploads");
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("blackbox-upload-batch-v1:1")).retryAt <= Date.now(),
  );
  await page.locator("#resource-upload button[type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#upload-batch-summary").textContent.includes("成功 2"));
  evidence.checks.push({ case: "限频时只发一项，等待后继续", limitedRequests, completed: 2 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#upload-batch").scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: out + "/upload-mobile.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  const uploaded = await s.upload("*姓名,*类别,*角色或分工\r\n新同学,演员,旁白\r\n同名,演员,主角\r\n");
  assert.equal(uploaded.status, 303);
  const batchUrl = uploaded.headers.get("location");
  await page.goto(base + batchUrl, { waitUntil: "networkidle" });
  const select = page.locator("select[name^=decision_]").first();
  const name = await select.getAttribute("name");
  await select.selectOption("create");
  await page.locator(".import-search input").fill("同名");
  await Promise.all([page.waitForURL("**?q=*"), page.locator(".import-search button").click()]);
  assert.equal(await page.locator(`[name="${name}"]`).inputValue(), "create");
  evidence.checks.push({ case: "搜索候选人员保留未提交选择", restored: "create" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: out + "/import-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1366, height: 768 });
  await s.env.FILES.put("synthetic/review.png", Buffer.from(png, "base64"), {
    httpMetadata: { contentType: "image/png" },
  });
  for (let i = 0; i < 49; i++)
    s.db
      .prepare(
        "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename,original_name) VALUES(10,30,2,'pending',?,'photo','synthetic/review.png',?)",
      )
      .run("待审合成剧照" + i, i + ".png");
  await page.goto(base + "/admin/resources/reviews", { waitUntil: "networkidle" });
  const auditBefore = s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_type='resource'").get().n;
  assert.equal(await page.locator("[data-review-id]").count(), 24);
  assert.equal(await page.locator("[data-review-id] img").count(), 24);
  await page.screenshot({ path: out + "/review-desktop.png" });
  const firstSelect = page.locator("[data-review-select]").first();
  await firstSelect.focus();
  await page.keyboard.press("Space");
  assert.equal(await firstSelect.isChecked(), true);
  await page.locator("[data-clear-selection]").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: out + "/review-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await firstSelect.tap();
  assert.equal(await firstSelect.isChecked(), true);
  await page.screenshot({ path: out + "/review-mobile-selected.png" });
  await page.locator("[data-clear-selection]").tap();
  await page.setViewportSize({ width: 360, height: 640 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: out + "/review-narrow.png" });
  await page.setViewportSize({ width: 1366, height: 768 });
  evidence.checks.push({
    case: "桌面键盘Space、手机触屏选择与360px窄屏",
    reducedMotion: "reduce",
    horizontalOverflow: false,
  });
  const processBatch = async (choice = "approve") => {
    await page.locator("[data-select-visible]").click();
    await page.locator("[name=checked_items]").check();
    await page.locator(`.review-batch button[value=${choice}]`).click();
  };
  for (const remaining of [25, 1, 0]) {
    await processBatch();
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("[data-review-id]").length === Math.min(expected, 24) &&
        !document.querySelector("[data-review-queue] button[disabled]"),
      remaining,
      { timeout: 30000 },
    );
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE status='pending'").get().n, remaining);
  }
  evidence.checks.push({
    case: "49条资料批量审核跨3页连续补队列",
    pending: 0,
    auditRows: s.db.prepare("SELECT COUNT(*) n FROM review_history WHERE entity_type='resource'").get().n - auditBefore,
  });
  const download = page.waitForEvent("download");
  await page.getByText("下载最近一次处理结果", { exact: true }).click();
  await (await download).saveAs(out + "/review-results.csv");
  // Stale item conflicts are retained while other selected items can finish.
  for (let i = 0; i < 2; i++)
    s.db
      .prepare(
        "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename,original_name) VALUES(10,30,2,'pending',?,'photo','synthetic/review.png','conflict.png')",
      )
      .run("冲突场景" + i);
  await page.goto(base + "/admin/resources/reviews", { waitUntil: "networkidle" });
  const conflictId = await page.locator("[data-review-id]").first().getAttribute("data-review-id");
  assert.equal((await s.post(1, `/admin/resources/${conflictId}/review`, { decision: "approve" })).status, 303);
  await processBatch();
  await page.waitForFunction(
    () =>
      document.querySelector("[data-review-row-status]")?.textContent.includes("状态已变化") &&
      document.querySelectorAll("[data-review-id]").length === 1,
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE status='pending'").get().n, 0);
  evidence.checks.push({ case: "另一管理员先处理其中一条，批量继续其余项", conflicts: 1, duplicateAudit: 0 });
  // A lost review response must stop the batch, without replaying or sending the next item.
  for (let i = 0; i < 2; i++)
    s.db
      .prepare(
        "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename,original_name) VALUES(10,30,2,'pending',?,'photo','synthetic/review.png','lost.png')",
      )
      .run("审核响应丢失" + i);
  await page.goto(base + "/admin/resources/reviews", { waitUntil: "networkidle" });
  loseReview = true;
  await processBatch();
  await page.waitForFunction(() => document.querySelector("[data-review-feedback]").textContent.includes("未执行 1"));
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE status='pending'").get().n, 1);
  loseReview = false;
  evidence.checks.push({ case: "审核已写入后连接中断", nextItemUnsent: true });
  const interruptedReport = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("blackbox-review-v2:1:/admin/resources/reviews:resource:result")),
  );
  assert.deepEqual(
    interruptedReport.results.map((r) => r.status),
    ["uncertain", "unsent"],
  );
  // Login/permission failures and malformed success responses must not advance the batch.
  s.db
    .prepare(
      "INSERT INTO resource(production_id,edition_id,uploader_id,status,title,res_type,filename,original_name) VALUES(10,30,2,'pending','认证异常场景','photo','synthetic/review.png','auth.png')",
    )
    .run();
  for (const status of [401, 403, 200]) {
    await page.goto(base + "/admin/resources/reviews", { waitUntil: "networkidle" });
    let requests = 0;
    await page.route("**/admin/resources/*/review", (route) => {
      requests++;
      return route.fulfill({
        status,
        contentType: "application/json",
        body: status === 200 ? "invalid-json" : JSON.stringify({ error: "合成认证异常" }),
      });
    });
    await processBatch();
    await page.waitForFunction(() => document.querySelector("[data-review-feedback]").textContent.includes("未执行 1"));
    assert.equal(requests, 1);
    assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE status='pending'").get().n, 2);
    await page.unroute("**/admin/resources/*/review");
  }
  evidence.checks.push({ case: "401/403/无效JSON暂停审核", subsequentRequests: 0 });
  await page.goto(base + "/admin/resources/reviews", { waitUntil: "networkidle" });
  await processBatch("reject");
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM resource WHERE status='pending'").get().n, 2);
  await page.locator("[name=batch_note]").fill("合成验收：资料不完整，请补充。");
  await processBatch("reject");
  await page.waitForFunction(() => document.querySelectorAll("[data-review-id]").length === 0);
  assert.equal(
    s.db
      .prepare(
        "SELECT COUNT(*) n FROM resource WHERE status='rejected' AND admin_note='合成验收：资料不完整，请补充。'",
      )
      .get().n,
    2,
  );
  evidence.checks.push({ case: "批量驳回强制理由并逐项保存", rejected: 2 });
  s.db.exec(
    "INSERT INTO production_join_request(user_id,member_id,production_id,edition_id,kind,role_name) VALUES(2,1,10,30,'cast','合成主角'),(2,1,10,30,'crew','合成灯光');",
  );
  await page.goto(base + "/admin/production-requests", { waitUntil: "networkidle" });
  await processBatch();
  await page.waitForFunction(() => document.querySelectorAll("[data-review-id]").length === 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM production_join_request WHERE status='approved'").get().n, 2);
  evidence.checks.push({ case: "演员与后台分工申请批量通过", approved: 2 });
  // Member identity approvals use their original separate approve/reject forms.
  s.db.exec(
    "INSERT INTO user(id,username,password_hash,role) VALUES(4,'合成甲','fixture','user'),(5,'合成乙','fixture','user');INSERT INTO join_request(user_id,apply_type,name,identity_note) VALUES(4,'new','合成甲','合成验证'),(5,'new','合成乙','合成验证');",
  );
  await page.goto(base + "/admin/member-requests", { waitUntil: "networkidle" });
  await processBatch();
  await page.waitForFunction(() => document.querySelectorAll("[data-review-id]").length === 0);
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM join_request WHERE status='approved'").get().n, 2);
  evidence.checks.push({ case: "认证申请批量明确确认", approved: 2 });
  assert.deepEqual(errors, []);
  evidence.errors = errors;
  evidence.failedRequests = failedRequests;
  writeFileSync(out + "/results.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await ctx.close();
} catch (error) {
  writeFileSync(
    out + "/failure.json",
    JSON.stringify(
      {
        message: error.message,
        pages: await Promise.all(
          browser
            .contexts()
            .flatMap((c) => c.pages())
            .map(async (p) => ({
              url: p.url(),
              text: await p.locator("body").innerText(),
              controls: await p.locator("#resource-upload").evaluate((f) =>
                [...f.elements].map((e) => ({
                  name: e.name,
                  value: e.value,
                  disabled: e.disabled,
                  valid: e.validity.valid,
                  message: e.validationMessage,
                })),
              ),
            })),
        ),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  s.db.close();
}
