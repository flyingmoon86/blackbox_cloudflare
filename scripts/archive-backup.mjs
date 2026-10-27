import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const digestPattern = /^[a-f0-9]{64}$/;
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const rowsDigest = (rows) =>
  digest(
    JSON.stringify(
      rows
        .map((row) =>
          JSON.stringify(
            Object.keys(row)
              .sort()
              .map((key) => [key, row[key]]),
          ),
        )
        .sort(),
    ),
  );

export async function fileDigest(path) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest("hex"), size };
}

function blobPath(directory, sha256) {
  if (!digestPattern.test(sha256 || "")) throw new Error("对象 SHA256 不合法。");
  // Never use a remote object key as a filesystem path.
  return join(directory, "objects", sha256.slice(0, 2), sha256);
}

async function validateFile(path, expected) {
  const actual = await fileDigest(path);
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size)
    throw new Error("备份内容校验失败（SHA256 或文件长度不符）。");
  return actual;
}

export function inspectDatabase(sql) {
  const database = new DatabaseSync(":memory:");
  try {
    // D1 exports interleave table creation and data. SQLite rejects inserts into
    // a child table whose parent has not been created, even with deferred FKs.
    // This is an isolated scratch database; validate every FK after loading.
    database.exec("PRAGMA foreign_keys=OFF; BEGIN;");
    database.exec(sql);
    const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length) throw new Error(`数据库存在 ${foreignKeys.length} 个外键错误。`);
    database.exec("COMMIT;");
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("数据库完整性检查失败。");
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all();
    const counts = {},
      rowHashes = {};
    for (const { name } of tables) {
      const rows = database.prepare(`SELECT * FROM ${quote(name)}`).all();
      counts[name] = rows.length;
      rowHashes[name] = rowsDigest(rows);
    }
    for (const required of ["production", "production_edition", "production_credit", "member", "resource"])
      if (!(required in counts)) throw new Error(`导出缺少核心数据表 ${required}。`);
    // Old snapshots predate private member photos; only query tables present in
    // that export. Archived photos still own their objects and must be backed up.
    const memberPhotoReferences = ["member_record_photo", "member_featured_photo"]
      .filter((table) => Object.hasOwn(counts, table))
      .map((table) => `UNION SELECT object_key FROM ${quote(table)} WHERE object_key<>''`)
      .join("\n");
    const references = database
      .prepare(
        `
      SELECT filename AS key FROM resource WHERE filename<>''
      UNION SELECT preview_filename FROM resource WHERE preview_filename IS NOT NULL AND preview_filename<>''
      UNION SELECT photo FROM member WHERE photo<>'' AND photo NOT LIKE 'https://%' AND photo NOT LIKE 'http://%'
      UNION SELECT avatar_preview FROM member WHERE avatar_preview IS NOT NULL AND avatar_preview<>''
        AND avatar_preview NOT LIKE 'https://%' AND avatar_preview NOT LIKE 'http://%'
      ${memberPhotoReferences}
    `,
      )
      .all()
      .map((row) => row.key)
      .sort();
    return { counts, rowHashes, references, integrity: "ok", foreignKeyErrors: 0 };
  } finally {
    database.close();
  }
}

function normalObject(object) {
  if (typeof object.key !== "string" || !object.key || !Number.isSafeInteger(object.size) || object.size < 0)
    throw new Error("R2 对象清单包含不合法的键或长度。");
  return {
    key: object.key,
    size: object.size,
    etag: String(object.etag || "").replaceAll('"', ""),
    lastModified: object.last_modified || object.lastModified || "",
    httpMetadata: object.http_metadata || object.httpMetadata || {},
    customMetadata: object.custom_metadata || object.customMetadata || {},
  };
}

const identity = (object) => JSON.stringify([object.key, object.size, object.etag, object.lastModified]);

export async function listAllObjects(client) {
  const objects = [],
    seenKeys = new Set(),
    seenCursors = new Set();
  let cursor;
  do {
    const page = await client.list(cursor);
    if (page.success !== true || !Array.isArray(page.result)) throw new Error("R2 列举响应无效。");
    for (const item of page.result) {
      const object = normalObject(item);
      if (seenKeys.has(object.key)) throw new Error("R2 分页出现重复对象，请在写入稳定后重试。");
      seenKeys.add(object.key);
      objects.push(object);
    }
    const info = page.result_info || {};
    if (info.is_truncated === true && !info.cursor) throw new Error("R2 分页缺少下一页游标。");
    // Older R2 responses omit result_info when below the page limit.
    if (info.is_truncated === undefined && !info.cursor && page.result.length >= 1000)
      throw new Error("R2 返回满页但没有游标，无法证明清单完整。");
    cursor = info.is_truncated === false ? undefined : info.cursor || undefined;
    if (cursor && seenCursors.has(cursor)) throw new Error("R2 分页游标重复。");
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

async function saveObject(directory, client, object) {
  const temporary = join(directory, "objects", `.partial-${randomUUID()}`);
  await mkdir(dirname(temporary), { recursive: true });
  const response = await client.get(object.key);
  if (!response.ok || !response.body) throw new Error(`R2 文件下载失败（HTTP ${response.status}）。`);
  const remoteEtag = response.headers.get("etag")?.replace(/^W\//i, "").replaceAll('"', "");
  if (remoteEtag && object.etag && remoteEtag !== object.etag) throw new Error("R2 对象在备份期间发生变化，请重试。");
  const sha = createHash("sha256"),
    md5 = createHash("md5");
  let size = 0;
  await pipeline(
    Readable.fromWeb(response.body),
    new Transform({
      transform(chunk, _, callback) {
        sha.update(chunk);
        md5.update(chunk);
        size += chunk.length;
        callback(null, chunk);
      },
    }),
    createWriteStream(temporary, { flags: "wx" }),
  );
  if (size !== object.size) throw new Error("下载的 R2 文件长度与清单不一致。");
  const contentMd5 = md5.digest();
  const expectedEtag = object.etag.toLowerCase();
  if (
    (/^[a-f0-9]{32}$/i.test(expectedEtag) && contentMd5.toString("hex") !== expectedEtag) ||
    (/^[a-f0-9]{32}-1$/i.test(expectedEtag) &&
      createHash("md5").update(contentMd5).digest("hex") + "-1" !== expectedEtag)
  )
    throw new Error("下载的 R2 文件与 ETag 校验不一致。");
  const sha256 = sha.digest("hex");
  const target = blobPath(directory, sha256);
  await mkdir(dirname(target), { recursive: true });
  if (existsSync(target)) {
    await validateFile(target, { sha256, size });
    // A same-content download can remain as a harmless partial after interruption.
    const { unlink } = await import("node:fs/promises");
    await unlink(temporary);
  } else await rename(temporary, target);
  return { ...object, sha256 };
}

async function latestManifest(directory, source) {
  const path = join(directory, "snapshots");
  if (!existsSync(path)) return null;
  const names = (await readdir(path)).sort().reverse();
  for (const name of names) {
    const snapshot = join(path, name);
    if (!existsSync(join(snapshot, "complete.json"))) continue;
    const manifest = await readManifest(snapshot);
    if (JSON.stringify(manifest.source) === JSON.stringify(source)) return manifest;
  }
  return null;
}

async function readManifest(snapshot) {
  const text = await readFile(join(snapshot, "manifest.json"), "utf8");
  const completion = JSON.parse(await readFile(join(snapshot, "complete.json"), "utf8"));
  if (completion.manifestSha256 !== digest(text)) throw new Error("备份清单校验失败。");
  const manifest = JSON.parse(text);
  if (manifest.version !== 1 || manifest.status !== "complete" || !Array.isArray(manifest.objects))
    throw new Error("备份格式不受支持或备份未完成。");
  return manifest;
}

export async function createSnapshot({ directory, source, exportDatabase, client }) {
  directory = resolve(directory);
  await mkdir(join(directory, "snapshots"), { recursive: true });
  const previous = await latestManifest(directory, source);
  const priorObjects = new Map(previous?.objects.map((object) => [object.key, object]) || []);
  const id = new Date().toISOString().replaceAll(":", "-") + "-" + randomUUID().slice(0, 8);
  const snapshot = join(directory, "snapshots", id);
  await mkdir(snapshot);
  await writeFile(join(snapshot, "pending.json"), json({ source, startedAt: new Date().toISOString() }), {
    flag: "wx",
  });
  const databasePath = join(snapshot, "database.sql");
  await exportDatabase(databasePath);
  const database = inspectDatabase(await readFile(databasePath, "utf8"));
  const remote = typeof client === "function" ? await client() : client;
  const inventory = await listAllObjects(remote);
  const keys = new Set(inventory.map((object) => object.key));
  const missing = database.references.filter((key) => !keys.has(key));
  if (missing.length) throw new Error(`数据库引用的 ${missing.length} 个文件不在 R2 中，备份未完成。`);
  const objects = [];
  let downloaded = 0;
  for (const object of inventory) {
    const prior = priorObjects.get(object.key);
    if (prior && object.etag && object.lastModified && identity(prior) === identity(object)) {
      await validateFile(blobPath(directory, prior.sha256), prior);
      objects.push({ ...object, sha256: prior.sha256 });
    } else {
      objects.push(await saveObject(directory, remote, object));
      downloaded++;
    }
  }
  const after = await listAllObjects(remote);
  if (JSON.stringify(inventory) !== JSON.stringify(after))
    throw new Error("R2 文件清单在备份期间改变，快照未完成，请在停止资料写入后重试。");
  const manifest = {
    version: 1,
    status: "complete",
    createdAt: new Date().toISOString(),
    source,
    database: { ...(await fileDigest(databasePath)), ...database },
    objects,
  };
  const text = json(manifest);
  await writeFile(join(snapshot, "manifest.json"), text, { flag: "wx" });
  await writeFile(join(snapshot, "complete.json"), json({ manifestSha256: digest(text) }), { flag: "wx" });
  return {
    snapshot,
    objects: objects.length,
    downloaded,
    reused: objects.length - downloaded,
    counts: database.counts,
  };
}

export async function verifySnapshot(snapshot) {
  snapshot = resolve(snapshot);
  if (basenameSafe(dirname(snapshot)) !== "snapshots") throw new Error("快照必须位于备份根目录的 snapshots 子目录中。");
  const directory = dirname(dirname(snapshot));
  const manifest = await readManifest(snapshot);
  await validateFile(join(snapshot, "database.sql"), manifest.database);
  const database = inspectDatabase(await readFile(join(snapshot, "database.sql"), "utf8"));
  if (
    JSON.stringify(database.counts) !== JSON.stringify(manifest.database.counts) ||
    JSON.stringify(database.rowHashes) !== JSON.stringify(manifest.database.rowHashes) ||
    JSON.stringify(database.references) !== JSON.stringify(manifest.database.references)
  )
    throw new Error("数据库摘要与备份清单不一致。");
  const keys = new Set();
  for (const object of manifest.objects) {
    if (keys.has(object.key)) throw new Error("备份清单出现重复对象。");
    keys.add(object.key);
    await validateFile(blobPath(directory, object.sha256), object);
  }
  if (database.references.some((key) => !keys.has(key))) throw new Error("备份缺少数据库引用的原件或预览。");
  return { manifest, directory, snapshot };
}

function basenameSafe(path) {
  return path.replaceAll("\\", "/").split("/").at(-1);
}

function isWithin(parent, child) {
  const part = relative(parent, child);
  return part === "" || (!part.startsWith("..") && !isAbsolute(part));
}

export function restoreSql(sql) {
  // Keep the original export untouched. For D1's FK-enabled importer, create
  // every parent table before inserting data, and create triggers after data.
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    db.exec(sql);
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("恢复 SQL 存在外键错误。");
    const schema = db
      .prepare(
        "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name",
      )
      .all();
    const tables = schema.filter((item) => item.type === "table");
    const output = ["PRAGMA defer_foreign_keys=TRUE;", ...tables.map((item) => item.sql + ";")];
    const literal = (value) =>
      value === null
        ? "NULL"
        : typeof value === "number"
          ? String(value)
          : value instanceof Uint8Array
            ? "X'" + Buffer.from(value).toString("hex") + "'"
            : "CAST(X'" + Buffer.from(String(value)).toString("hex") + "' AS TEXT)";
    const insertRows = (name) => {
      for (const row of db.prepare(`SELECT * FROM ${quote(name)}`).all())
        output.push(
          `INSERT INTO ${quote(name)} (${Object.keys(row).map(quote).join(",")}) VALUES(${Object.values(row).map(literal).join(",")});`,
        );
    };
    for (const table of tables) insertRows(table.name);
    if (db.prepare("SELECT 1 FROM sqlite_schema WHERE name='sqlite_sequence'").get()) {
      output.push("DELETE FROM sqlite_sequence;");
      insertRows("sqlite_sequence");
    }
    output.push(...schema.filter((item) => item.type !== "table").map((item) => item.sql + ";"));
    return output.join("\n");
  } finally {
    db.close();
  }
}

export async function restoreLocal(snapshot, target) {
  if (!target) throw new Error("必须显式指定 --target 本地隔离目录。");
  target = resolve(target);
  const verified = await verifySnapshot(snapshot);
  if (isWithin(verified.directory, target) || isWithin(target, verified.directory) || isWithin(target, root))
    throw new Error("恢复目录不得覆盖代码或备份仓库，也不得位于备份仓库中。");
  // An existing directory is never accepted, including an empty one and a symlink.
  if (existsSync(target)) throw new Error("恢复目录已经存在；请指定一个尚不存在的新目录。");
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const importPath = join(target, "restore.sql");
  await writeFile(importPath, restoreSql(await readFile(join(verified.snapshot, "database.sql"), "utf8")), {
    flag: "wx",
  });
  const configPath = join(target, "wrangler.json");
  const config = {
    name: "blackbox-isolated-restore",
    compatibility_date: "2026-09-08",
    main: "worker.mjs",
    d1_databases: [
      { binding: "DB", database_name: "archive-restore", database_id: "00000000-0000-0000-0000-000000000001" },
    ],
    r2_buckets: [{ binding: "FILES", bucket_name: "archive-restore-files" }],
  };
  await writeFile(configPath, json(config), { flag: "wx" });
  await writeFile(
    join(target, "worker.mjs"),
    "export default { fetch() { return new Response('Isolated archive restore'); } };\n",
    { flag: "wx" },
  );
  const state = join(target, "state");
  const wrangler = fileURLToPath(new URL("./wrangler.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "archive-restore",
      "--local",
      "--config",
      configPath,
      "--persist-to",
      state,
      "--file",
      importPath,
    ],
    { cwd: root, env: process.env, stdio: "pipe", encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0)
    throw new Error("隔离 D1 导入失败；目标目录已保留以供排查。没有修改远程环境。");
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({
    configPath,
    persist: { path: join(state, "v3") },
    remoteBindings: false,
    envFiles: [],
  });
  try {
    const { DB, FILES } = proxy.env;
    for (const object of verified.manifest.objects) {
      const bytes = await readFile(blobPath(verified.directory, object.sha256));
      const metadata = { ...object.httpMetadata };
      if (metadata.cacheExpiry) metadata.cacheExpiry = new Date(metadata.cacheExpiry);
      await FILES.put(object.key, bytes, { httpMetadata: metadata, customMetadata: object.customMetadata });
      const restored = await FILES.get(object.key);
      if (
        !restored ||
        restored.size !== object.size ||
        digest(Buffer.from(await restored.arrayBuffer())) !== object.sha256
      )
        throw new Error("隔离 R2 恢复后的文件内容校验失败。");
    }
    const foreignKeys = await DB.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.results.length) throw new Error("隔离 D1 存在外键错误。");
    for (const [table, count] of Object.entries(verified.manifest.database.counts)) {
      const rows = (await DB.prepare(`SELECT * FROM ${quote(table)}`).all()).results;
      if (rows.length !== count || rowsDigest(rows) !== verified.manifest.database.rowHashes[table])
        throw new Error(`隔离 D1 表 ${table} 的记录数或内容摘要不符。`);
    }
    for (const key of verified.manifest.database.references)
      if (!(await FILES.head(key))) throw new Error("隔离 D1 引用的文件恢复后不存在。");
    const report = {
      verifiedAt: new Date().toISOString(),
      mode: "local-only",
      sourceSnapshot: verified.snapshot,
      objects: verified.manifest.objects.length,
      referencedFiles: verified.manifest.database.references.length,
      counts: verified.manifest.database.counts,
      foreignKeyErrors: 0,
      originalBytesVerified: true,
      databaseRowsVerified: true,
    };
    await writeFile(join(target, "restore-report.json"), json(report), { flag: "wx" });
    return { target, ...report };
  } finally {
    await proxy.dispose();
  }
}

function tokenFromWrangler() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const paths = [
    process.env.BLACKBOX_WRANGLER_AUTH_FILE,
    process.env.APPDATA && join(process.env.APPDATA, "xdg.config", ".wrangler", "config", "default.toml"),
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), ".wrangler", "config", "default.toml"),
    join(homedir(), ".wrangler", "config", "default.toml"),
  ].filter(Boolean);
  return (async () => {
    for (const path of paths) {
      if (!existsSync(path)) continue;
      const text = await readFile(path, "utf8");
      const token = text.match(/^\s*(?:oauth_token|api_token)\s*=\s*"([^"\r\n]+)"/m)?.[1];
      if (token) return token;
    }
    throw new Error("缺少 Cloudflare 只读凭据；请运行 Wrangler login 或设置 CLOUDFLARE_API_TOKEN。");
  })();
}

export async function cloudflareClient(account, bucket) {
  const token = await tokenFromWrangler();
  const { request, ProxyAgent } = await import("undici");
  const proxy = (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  )?.replace(/^\[(https?:\/\/[^\]]+)\]\(\1\)$/, "$1");
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const prefix = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  async function get(url) {
    // Requests are GET-only, with no endpoint override or credential logging.
    let response;
    try {
      const result = await request(url, {
        headers: { Authorization: `Bearer ${token}` },
        dispatcher,
        signal: AbortSignal.timeout(120_000),
      });
      // request() preserves content-encoded object bytes; fetch() decompresses them.
      // A backup must store precisely the bytes represented by the R2 ETag.
      response = new Response(Readable.toWeb(result.body), {
        status: result.statusCode,
        headers: Object.fromEntries(
          Object.entries(result.headers)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
        ),
      });
    } catch {
      throw new Error("Cloudflare 只读请求失败；检查网络、代理和凭据。");
    }
    if (!response.ok) throw new Error(`Cloudflare 只读请求失败（HTTP ${response.status}）；未写入远程数据。`);
    return response;
  }
  return {
    list: async (cursor) =>
      (await get(prefix + "?per_page=1000" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""))).json(),
    get: (key) => get(prefix + "/" + encodeURIComponent(key)),
  };
}

function parseArguments(args) {
  const [command, ...rest] = args;
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!["--directory", "--snapshot", "--target"].includes(rest[i]) || !rest[i + 1] || rest[i + 1].startsWith("--"))
      throw new Error("参数不合法；支持 --directory、--snapshot、--target，各参数必须指定路径。");
    if (options[rest[i]]) throw new Error("参数重复。");
    options[rest[i]] = rest[i + 1];
  }
  return { command, options };
}

export async function main(args = process.argv.slice(2)) {
  const { command, options } = parseArguments(args);
  if (command === "snapshot") {
    const config = JSON.parse(await readFile(join(root, "wrangler.jsonc"), "utf8"));
    const production = config.env?.production;
    const database = production?.d1_databases?.find((item) => item.binding === "DB");
    const bucket = production?.r2_buckets?.find((item) => item.binding === "FILES");
    if (!production?.account_id || !database?.database_name || !bucket?.bucket_name)
      throw new Error("缺少 production D1/R2 配置。");
    const source = { account: production.account_id, database: database.database_id, bucket: bucket.bucket_name };
    const result = await createSnapshot({
      directory: options["--directory"] || join(root, "migration-work", "archive-backups"),
      source,
      exportDatabase: async (output) => {
        const result = spawnSync(
          process.execPath,
          [
            join(root, "scripts", "wrangler.mjs"),
            "d1",
            "export",
            database.database_name,
            "--remote",
            "--env",
            "production",
            "--output",
            output,
          ],
          { cwd: root, env: process.env, stdio: "inherit" },
        );
        if (result.error || result.status !== 0) throw new Error("D1 导出失败；完整备份未完成。");
      },
      // Read OAuth only after Wrangler export has refreshed it if needed.
      client: () => cloudflareClient(source.account, source.bucket),
    });
    console.log(json({ status: "verified-backup", ...result }));
  } else if (command === "verify") {
    if (!options["--snapshot"]) throw new Error("必须指定 --snapshot。");
    const { manifest, snapshot } = await verifySnapshot(options["--snapshot"]);
    console.log(
      json({ status: "verified", snapshot, objects: manifest.objects.length, counts: manifest.database.counts }),
    );
  } else if (command === "restore-local") {
    if (!options["--snapshot"] || !options["--target"]) throw new Error("必须同时指定 --snapshot 和 --target。");
    console.log(json(await restoreLocal(options["--snapshot"], options["--target"])));
  } else if (command === "drill") {
    if (!options["--target"]) throw new Error("演练必须显式指定尚不存在的 --target 目录。");
    const { runFixtureDrill } = await import("./archive-backup-fixture.mjs");
    console.log(json(await runFixtureDrill(resolve(options["--target"]))));
  } else
    throw new Error(
      "用法：archive-backup.mjs snapshot | verify --snapshot 路径 | restore-local --snapshot 路径 --target 新目录 | drill --target 新目录",
    );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
