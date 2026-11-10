import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const releaseDirectory = (root) => resolve(root, "artifacts/working/asset-release-manifests");
const assetName = /^\/assets\/[a-zA-Z0-9_.-]+$/;

export function currentAssets(root) {
  const source = readFileSync(resolve(root, "src/generated/assets.ts"), "utf8");
  const mapping = JSON.parse(
    source
      .slice(source.indexOf("= ") + 2)
      .trim()
      .replace(/;$/, ""),
  );
  return [...new Set(Object.values(mapping))].sort().map((url) => {
    if (typeof url !== "string" || !assetName.test(url)) throw new Error("Invalid asset URL");
    const bytes = readFileSync(resolve(root, "public" + url));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!url.includes("." + sha256.slice(0, 16) + ".")) throw new Error("Asset hash mismatch: " + url);
    return { url, bytes: bytes.length, sha256 };
  });
}

// Call only after a successful deployment. A local build is not a published release.
export function recordAssetRelease(root, assets, now = new Date()) {
  const directory = releaseDirectory(root);
  mkdirSync(directory, { recursive: true });
  const id = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
  const path = resolve(directory, `${now.toISOString().replaceAll(":", "-")}-${id}.json`);
  writeFileSync(path, JSON.stringify({ schema: 1, deployedAt: now.toISOString(), id, assets }, null, 2) + "\n", {
    flag: "wx",
  });
  return path;
}

export function assetInventory(root, { now = new Date(), retentionDays = 30, minimumReleases = 2 } = {}) {
  if (!Number.isFinite(retentionDays) || retentionDays < 0 || !Number.isInteger(minimumReleases) || minimumReleases < 1)
    throw new Error("Invalid retention policy");
  const current = new Set(currentAssets(root).map((asset) => asset.url));
  const directory = releaseDirectory(root);
  const releases = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.endsWith(".json"))
        .map((name) => {
          const record = JSON.parse(readFileSync(resolve(directory, name), "utf8"));
          if (
            record.schema !== 1 ||
            !Number.isFinite(Date.parse(record.deployedAt)) ||
            !Array.isArray(record.assets) ||
            record.assets.some((asset) => typeof asset.url !== "string" || !assetName.test(asset.url))
          )
            throw new Error("Invalid release manifest: " + name);
          return record;
        })
        .sort((a, b) => Date.parse(b.deployedAt) - Date.parse(a.deployedAt))
    : [];
  const protectedAssets = new Set(),
    known = new Set();
  releases.forEach((release, index) => {
    const protectedRelease =
      release.keep === true ||
      index < minimumReleases ||
      now - new Date(release.deployedAt) <= retentionDays * 86400000;
    for (const asset of release.assets) {
      known.add(asset.url);
      if (protectedRelease) protectedAssets.add(asset.url);
    }
  });
  const files = readdirSync(resolve(root, "public/assets"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(({ name }) => {
      const url = "/assets/" + name;
      const status = current.has(url)
        ? "current"
        : protectedAssets.has(url)
          ? "protected-release"
          : known.has(url)
            ? "review-candidate"
            : "untracked-keep";
      return { url, bytes: statSync(resolve(root, "public/assets", name)).size, status };
    })
    .sort((a, b) => a.url.localeCompare(b.url));
  const counts = Object.fromEntries(
    ["current", "protected-release", "review-candidate", "untracked-keep"].map((status) => [
      status,
      files.filter((file) => file.status === status).length,
    ]),
  );
  return {
    schema: 1,
    generatedAt: now.toISOString(),
    retentionDays,
    minimumReleases,
    releaseCount: releases.length,
    counts,
    files,
    policy:
      "Read-only inventory. Untracked files must be retained. Review candidates still require old-page, rollback and backup review; this tool never deletes files.",
  };
}
