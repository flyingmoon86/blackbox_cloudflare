import assert from "node:assert/strict";
import { join } from "node:path";
import { creditFixture } from "../backend/credit-import-fixture.mjs";
import { serveWorker, staticAssets } from "./worker-server.mjs";

export async function checkCreditClient(browser, output) {
  const fixture = await creditFixture();
  fixture.env.ASSETS = staticAssets();
  const server = await serveWorker({ worker: fixture.worker, env: fixture.env, allowWrites: true });
  const results = [];
  try {
    for (const width of [1366, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 768 },
        reducedMotion: "reduce",
        hasTouch: width === 390,
        isMobile: width === 390,
      });
      await context.addCookies(
        fixture.cookies[1].split("; ").map((pair) => {
          const at = pair.indexOf("=");
          return { name: pair.slice(0, at), value: pair.slice(at + 1), url: server.origin };
        }),
      );
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        const uploaded = await fixture.upload(
          `*姓名,*类别,*角色或分工\n新增队员${width},演员,测试角色${width}\n张三,演员,配角${width}\n`,
        );
        assert.equal(uploaded.status, 303);
        const batch = uploaded.headers.get("Location");
        await page.goto(server.origin + batch);
        assert.equal(await page.locator('script[src*="credit-import."]').count(), 1);
        const select = page.locator('select[name^="decision_"]').first();
        const name = await select.getAttribute("name");
        await select.selectOption("create");
        await page.locator(".import-search input").fill("张三");
        await page.locator(".import-search button").click();
        await page.waitForURL(/\?q=/);
        assert.equal(await page.locator(`[name="${name}"]`).inputValue(), "create");
        results.push(`${width} import choices survive search`);
        await page.getByRole("button", { name: "保存选择并重新检查", exact: true }).click();
        const form = page.locator("form[data-import-confirm]");
        await form.waitFor();
        await form.locator('input[type="checkbox"]').check();
        await form.locator("button").click();
        await page.getByText("导入完成。重复确认不会再次创建记录。", { exact: true }).waitFor();
        assert.equal(
          fixture.db.prepare("SELECT COUNT(*) n FROM production_credit WHERE role_name=?").get(`测试角色${width}`).n,
          1,
        );
        results.push(`${width} import confirmation commits once`);
        await page.screenshot({ path: join(output, `import-${width}.png`), fullPage: true });

        // An uncertain write must expose the status link without replaying POST.
        const uncertain = await fixture.upload(`*姓名,*类别,*角色或分工\n张三,演员,异常响应${width}\n`);
        const uncertainPath = uncertain.headers.get("Location");
        await page.goto(server.origin + uncertainPath);
        await page.locator("form[data-import-confirm]").waitFor();
        let posts = 0;
        await page.route("**" + uncertainPath + "/confirm", (route) => {
          posts++;
          return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
        });
        await page.locator('form[data-import-confirm] input[type="checkbox"]').check();
        await page.locator("form[data-import-confirm] button").click();
        await page.locator("[data-import-check]").waitFor({ state: "visible" });
        assert.equal(await page.locator("form[data-import-confirm] button").isDisabled(), true);
        assert.equal(posts, 1);
        assert.equal(
          fixture.db.prepare("SELECT COUNT(*) n FROM production_credit WHERE role_name=?").get(`异常响应${width}`).n,
          0,
        );
        assert.deepEqual(errors, []);
        results.push(`${width} uncertain confirmation exposes status without duplicate submission`);
      } finally {
        await context.close();
      }
    }
    return results;
  } finally {
    await server.close();
    fixture.db.close();
  }
}
