import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { zlibSync } from "fflate";
import { createDatabase, d1, loadWorker, loadModule, fakeBucket, context } from "./harness.mjs";
const worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
const { inspectStagePng, stageSettings } = await loadModule("src/services/stage-visuals.ts");
const { prepareStageUpdate } = await loadModule("src/services/stage-upload.ts");
const base = readFileSync("public/images/theatre-unlit.png"),
  light = readFileSync("public/images/theatre-light.png");
function png(width, height, alpha) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunk = (type, data) => {
    const b = Buffer.alloc(data.length + 12);
    b.writeUInt32BE(data.length);
    b.write(type, 4);
    Buffer.from(data).copy(b, 8);
    let crc = 0xffffffff;
    for (const byte of b.subarray(4, -4)) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4);
    return b;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * (width * 4 + 1) + x * 4 + 1;
      pixels[i] = 240;
      pixels[i + 1] = 210;
      pixels[i + 2] = 130;
      pixels[i + 3] = typeof alpha === "function" ? alpha(x, y) : alpha;
    }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", zlibSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function stageForm(scene = "home") {
  const f = new FormData();
  const c = stageSettings()[scene];
  for (const k of ["intensity", "shade", "desktopX", "desktopY", "mobileX", "mobileY"])
    f.set(`stage_${scene}_${k}`, String(c[k]));
  f.set(`stage_${scene}_pair`, "current");
  f.set(`stage_${scene}_direction`, "preset");
  return f;
}
test("all four supplied pairs decode with matching dimensions and genuine transparent light", () => {
  for (const prefix of ["theatre", "productions", "members", "thanks"]) {
    const a = inspectStagePng(readFileSync(`public/images/${prefix}-unlit.png`));
    const b = inspectStagePng(readFileSync(`public/images/${prefix}-light.png`), true);
    assert.deepEqual(a, b);
  }
  assert.throws(() => inspectStagePng(png(2, 2, 255), true), /透明/);
  assert.throws(() => inspectStagePng(png(2, 2, 0), true), /透明/);
  assert.throws(() => inspectStagePng(Buffer.from("not a png")), /PNG/);
});
test("pair validation is atomic, rejects incomplete or mismatched uploads and invalid parameters", async () => {
  const f = stageForm();
  f.set("stage_home_pair", "upload");
  f.set("stage_home_base", new File([base], "base.png"));
  await assert.rejects(prepareStageUpdate(f, {}), /同时选择/);
  f.set("stage_home_light", new File([png(2, 2, (x) => (x ? 255 : 0))], "light.png"));
  await assert.rejects(prepareStageUpdate(f, {}), /相同/);
  f.set("stage_home_light", new File([light], "light.png"));
  const texts = { unrelated: "kept" };
  const uploads = await prepareStageUpdate(f, texts);
  assert.equal(uploads.length, 2);
  assert.equal(texts.unrelated, "kept");
  assert.ok(JSON.parse(texts.stage_visuals).home.pair.key);
  f.set("stage_home_shade", "101");
  await assert.rejects(prepareStageUpdate(f, {}), /0–100/);
});
test("admin saves paired settings, serves original alpha PNG, preserves unrelated settings and enforces auth/CSRF", async () => {
  const db = createDatabase();
  try {
    db.exec(
      "INSERT INTO user(id,username,password_hash,role) VALUES(1,'stage-admin','test','admin'),(2,'stage-user','test','user'); UPDATE site_profile SET hero_photo='legacy-value',page_texts='{\"unrelated\":\"keep\",\"thanks_background\":\"77\"}' WHERE id=1",
    );
    const env = {
      DB: d1(db),
      FILES: fakeBucket(),
      SESSION_SECRET: "stage-test",
      ENVIRONMENT: "development",
      ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    };
    const cookies = {};
    for (const id of [1, 2])
      cookies[id] =
        "blackbox_csrf=stage-csrf; blackbox_session=" +
        (await createSession({ uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 3600 }, env.SESSION_SECRET));
    const req = (path, id = 1, init = {}) =>
      worker.fetch(
        new Request("https://blackbox.test" + path, {
          ...init,
          headers: { Cookie: cookies[id] || "", ...init.headers },
        }),
        env,
        context(),
      );
    assert.equal((await req("/admin/site", 0)).status, 302);
    assert.equal((await req("/admin/site", 2)).status, 403);
    let r = await req("/admin/site");
    const html = await r.text();
    assert.match(html, /data-stage-editor="thanks"/);
    assert.doesNotMatch(html, /name="hero_photo"/);
    assert.match(r.headers.get("Content-Security-Policy"), /frame-src 'self'/);
    r = await req("/?stage-preview=1");
    assert.equal(r.headers.get("X-Frame-Options"), "SAMEORIGIN");
    r = await req("/?stage-preview=1", 2);
    assert.equal(r.headers.get("X-Frame-Options"), "DENY");
    const f = stageForm("productions");
    f.set("stage_productions_intensity", "72");
    f.set("stage_productions_mobileX", "64");
    f.set("stage_productions_pair", "upload");
    f.set("stage_productions_base", new File([base], "base.png"));
    f.set("stage_productions_light", new File([light], "light.png"));
    assert.equal((await req("/admin/site", 1, { method: "POST", body: f })).status, 400);
    f.set("csrf", "stage-csrf");
    assert.equal((await req("/admin/site", 2, { method: "POST", body: f })).status, 403);
    f.set("troupe_name", "test");
    r = await req("/admin/site", 1, { method: "POST", body: f });
    assert.equal(r.status, 303, await r.text());
    const row = db.prepare("SELECT hero_photo,page_texts FROM site_profile WHERE id=1").get();
    assert.equal(row.hero_photo, "legacy-value");
    const texts = JSON.parse(row.page_texts);
    assert.equal(texts.unrelated, "keep");
    assert.equal(texts.thanks_background, "77");
    assert.equal(JSON.parse(texts.stage_visuals).productions.intensity, 72);
    r = await req("/site/stage-image/productions/light", 0);
    assert.equal(r.status, 200);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), light);
    r = await req("/productions", 0);
    assert.match(await r.text(), /&quot;intensity&quot;:72/);
    assert.equal((await req("/site/stage-image/unknown/light", 0)).status, 404);
    const reset = stageForm("productions");
    reset.set("csrf", "stage-csrf");
    reset.set("stage_productions_pair", "builtin");
    await req("/admin/site", 1, { method: "POST", body: reset });
    assert.equal((await req("/site/stage-image/productions/light", 0)).status, 404);
  } finally {
    db.close();
  }
});
