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
  assert.match(head, /theme\.css\?production=7/);
  assert.match(html.match(/<body[^>]+>/)[0], /archive-page/);
});
