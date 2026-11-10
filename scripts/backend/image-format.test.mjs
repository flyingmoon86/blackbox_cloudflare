import assert from "node:assert/strict";
import test from "node:test";
import { loadModule, createDatabase, d1, fakeBucket } from "./harness.mjs";
const { imageFormat, matchesImageMime } = await loadModule("src/services/image-format.ts");
const { storeMemberPhoto } = await loadModule("src/services/member-photo-storage.ts");
const ftyp = (major, compatible = []) => {
  const bytes = new Uint8Array(16 + compatible.length * 4);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode("ftyp" + major), 4);
  compatible.forEach((brand, i) => bytes.set(new TextEncoder().encode(brand), 16 + i * 4));
  return bytes;
};
test("shared image signatures recognize supported formats and reject mismatched MIME or truncated headers", () => {
  const samples = [
    [new Uint8Array([255, 216, 255, 0]), "jpeg"],
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "png"],
    [new TextEncoder().encode("RIFF0000WEBP"), "webp"],
    [ftyp("avif"), "avif"],
    [ftyp("avis"), "avif"],
    [ftyp("mif1", ["avif"]), "avif"],
  ];
  for (const [bytes, format] of samples) {
    assert.equal(imageFormat(bytes), format);
    assert.equal(matchesImageMime(bytes, `image/${format}`), true);
    assert.equal(matchesImageMime(bytes, "image/gif"), false);
  }
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([255, 216]),
    new TextEncoder().encode("RIFF0000WEB"),
    ftyp("isom"),
  ])
    assert.equal(imageFormat(bytes), null);
  const version = ftyp("mif1");
  version.set(new TextEncoder().encode("avif"), 12);
  assert.equal(imageFormat(version), null, "version bytes are not a compatible brand");
  const outside = ftyp("isom", ["avif"]);
  new DataView(outside.buffer).setUint32(0, 16);
  assert.equal(imageFormat(outside), null, "brand outside ftyp must not count");
});
test("private member photos keep their own format and size policy before storage writes", async () => {
  const db = createDatabase(),
    env = { DB: d1(db), FILES: fakeBucket() };
  const insert = () => {
    throw Error("must not create storage references");
  };
  try {
    await assert.rejects(
      storeMemberPhoto(env, 1, new File([ftyp("avif")], "image.avif", { type: "image/avif" }), insert),
      /格式不一致/,
    );
    await assert.rejects(
      storeMemberPhoto(env, 1, new File([new Uint8Array([255, 216, 255])], "image.png", { type: "image/png" }), insert),
      /格式不一致/,
    );
    await assert.rejects(
      storeMemberPhoto(
        env,
        1,
        new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" }),
        insert,
      ),
      /8MB/,
    );
    assert.equal(env.DB.calls, 0);
  } finally {
    db.close();
  }
});
