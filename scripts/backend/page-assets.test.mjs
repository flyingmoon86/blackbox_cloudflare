import test from "node:test";
import assert from "node:assert/strict";
import { loadModule } from "./harness.mjs";
const { layout } = await loadModule("src/views/layout.ts");

test("page capabilities do not depend on words or CSS classes in rendered content", () => {
  const html = layout(
    "示例",
    '<p>data-resource-picker</p><div class="section-tabs"></div><div class="production-cover work-cover-frame"></div>',
  );
  const head = html.split("</head>")[0];
  assert.doesNotMatch(head, /resource-picker\.[a-f0-9]+\.(js|css)/);
  assert.doesNotMatch(head, /work-browse\.[a-f0-9]+\.css/);
  assert.doesNotMatch(head, /member-dossier\.[a-f0-9]+\.js/);
  assert.doesNotMatch(html.match(/<body[^>]+>/)[0], /archive-page/);
});

test("explicit page options load the required controls and preserve the production theme", () => {
  const html = layout("示例", "<main>内容</main>", true, true, {
    themeId: 7,
    archive: true,
    workCover: true,
    resourcePicker: true,
    memberDossier: true,
  });
  const head = html.split("</head>")[0];
  assert.match(head, /resource-picker\.[a-f0-9]+\.js/);
  assert.match(head, /work-browse\.[a-f0-9]+\.css/);
  assert.match(head, /member-dossier\.[a-f0-9]+\.js/);
  assert.match(head, /member-results\.[a-f0-9]+\.js/);
  assert.match(head, /theme\.css\?production=7/);
  assert.match(html.match(/<body[^>]+>/)[0], /archive-page/);
});

test("administrative enhancements load only for the declared page and administrator", () => {
  const guest = layout("示例", "", false, false, { creditForms: true, creditImport: true });
  assert.doesNotMatch(guest, /assets\/(?:admin-notifications|credit-forms|credit-import)\./);
  const admin = layout("示例", "", true, true);
  assert.match(admin, /assets\/admin-notifications\./);
  assert.doesNotMatch(admin, /assets\/(?:credit-forms|credit-import)\./);
  const forms = layout("示例", "", true, true, { creditForms: true });
  assert.match(forms, /assets\/credit-forms\./);
  assert.doesNotMatch(forms, /assets\/credit-import\./);
  const imports = layout("示例", "", true, true, { creditImport: true });
  assert.match(imports, /assets\/credit-import\./);
  assert.doesNotMatch(imports, /assets\/credit-forms\./);
});
