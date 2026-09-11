import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";
// Node test substitute for the Workers-only primitive; real runtime is tested separately.
globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor(expected) {
    let received = 0;
    super({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > expected) throw Error("overrun");
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== expected) throw Error("truncated");
      },
    });
  }
};
export function createDatabase(maxMigration = Infinity) {
  const db = new DatabaseSync(":memory:");
  for (const name of readdirSync("migrations").sort()) {
    if (name.endsWith(".sql") && Number(name.split("_")[0]) <= maxMigration)
      db.exec(readFileSync(join("migrations", name), "utf8"));
  }
  return db;
}
export function d1(db) {
  let calls = 0;
  const api = {
    get calls() {
      return calls;
    },
    prepare(sql) {
      const statement = (args = []) => ({
        bind(...values) {
          return statement(values);
        },
        async first(column) {
          calls++;
          const row = db.prepare(sql).get(...args);
          return row ? (column ? row[column] : row) : null;
        },
        async all() {
          calls++;
          const results = db.prepare(sql).all(...args);
          return { success: true, results, meta: {} };
        },
        async run() {
          calls++;
          const result = db.prepare(sql).run(...args);
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) },
          };
        },
        async raw() {
          calls++;
          return db
            .prepare(sql)
            .all(...args)
            .map(Object.values);
        },
      });
      return statement();
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      calls++;
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return api;
}
let serial = 0;
export async function loadModule(entry) {
  const directory = mkdtempSync(join(tmpdir(), "blackbox-test-"));
  const outfile = join(directory, "test.mjs");
  buildSync({
    entryPoints: [resolve(entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(outfile).href + `?v=${serial++}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
export async function loadWorker() {
  return (await loadModule("src/index.ts")).default;
}
export function context() {
  const pending = [];
  return {
    waitUntil(p) {
      pending.push(p);
    },
    passThroughOnException() {},
    async flush() {
      await Promise.all(pending);
    },
  };
}
export function fakeBucket() {
  const objects = new Map(),
    multiparts = new Map();
  let writes = 0;
  const object = (key, entry, range) => {
    const all = entry.bytes;
    let offset = 0,
      length = all.length;
    if (range instanceof Headers) {
      const match = /bytes=(\d*)-(\d*)/.exec(range.get("range") || "");
      if (match) {
        offset = match[1] ? Number(match[1]) : Math.max(0, all.length - Number(match[2]));
        length = match[1]
          ? (match[2] ? Math.min(all.length - 1, Number(match[2])) : all.length - 1) - offset + 1
          : all.length - offset;
      }
    } else if (range) {
      offset = range.offset ?? Math.max(0, all.length - (range.suffix ?? all.length));
      length = range.length ?? all.length - offset;
    }
    return {
      key,
      size: all.length,
      etag: entry.etag,
      httpEtag: `"${entry.etag}"`,
      uploaded: new Date(),
      httpMetadata: entry.metadata,
      range: range ? { offset, length } : undefined,
      body: new Blob([all.slice(offset, offset + length)]).stream(),
      arrayBuffer: async () => all.slice(offset, offset + length).buffer,
      writeHttpMetadata(headers) {
        for (const [k, v] of Object.entries(entry.metadata || {})) {
          const key = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
          headers.set(key, v);
        }
      },
    };
  };
  const api = {
    objects,
    multiparts,
    get writes() {
      return writes;
    },
    async put(key, body, options = {}) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const entry = { bytes, metadata: options.httpMetadata || {}, etag: `etag-${++writes}` };
      objects.set(key, entry);
      return object(key, entry);
    },
    async head(key) {
      return objects.has(key) ? object(key, objects.get(key)) : null;
    },
    async get(key, options = {}) {
      return objects.has(key) ? object(key, objects.get(key), options.range) : null;
    },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    },
    async list() {
      return { objects: [...objects].map(([key, v]) => object(key, v)), truncated: false, delimitedPrefixes: [] };
    },
    async createMultipartUpload(key, options = {}) {
      const uploadId = crypto.randomUUID();
      multiparts.set(uploadId, { key, options, parts: new Map() });
      return api.resumeMultipartUpload(key, uploadId);
    },
    resumeMultipartUpload(key, uploadId) {
      return {
        key,
        uploadId,
        async uploadPart(n, body) {
          const task = multiparts.get(uploadId);
          if (!task) throw Error("multipart missing");
          const bytes = new Uint8Array(await new Response(body).arrayBuffer());
          task.parts.set(n, bytes);
          return { partNumber: n, etag: `part-${n}` };
        },
        async complete(parts) {
          const task = multiparts.get(uploadId);
          if (!task) throw Error("multipart missing");
          const arrays = parts.map((p) => task.parts.get(p.partNumber));
          if (arrays.some((a) => !a)) throw Error("parts missing");
          const result = await api.put(key, new Blob(arrays), task.options);
          multiparts.delete(uploadId);
          return result;
        },
        async abort() {
          multiparts.delete(uploadId);
        },
      };
    },
  };
  return api;
}
