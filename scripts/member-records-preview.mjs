// Disposable loopback-only fixture: all identities, files and data are synthetic.
// No real D1, R2, .dev.vars, passwords or backups are loaded.
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { createDatabase, d1, fakeBucket, loadModule, loadWorker, context } from "./backend/harness.mjs";
const db = createDatabase(),
  worker = await loadWorker();
const { createSession } = await loadModule("src/auth/session.ts");
db.exec(
  "INSERT INTO member(id,name) VALUES(1,'合成队员甲'),(2,'合成队员乙'),(3,'合成待补录'); INSERT INTO user(id,username,password_hash,role,member_id) VALUES(1,'验收管理员','fixture','admin',NULL),(2,'验收本人','fixture','member',1),(3,'验收其他队员','fixture','member',2),(4,'验收普通账号','fixture','user',NULL); UPDATE storage_budget SET initialized=1",
);
const record = crypto.randomUUID(),
  moment = crypto.randomUUID();
db.prepare(
  "INSERT INTO member_record(id,member_id,kind,graduation_year,knowledge,destination_type,details,updated_by) VALUES(?,1,'destination',2026,'provided','recommendation',?,2)",
).run(
  record,
  JSON.stringify({
    undergraduate: "",
    graduate: "合成保密研究生院校",
    doctoral: "",
    employer: "",
    supplement: "合成专业",
    source: "合成内部来源",
    notes: "合成内部备注",
  }),
);
db.prepare(
  "INSERT INTO member_record(id,member_id,kind,title,event_date,details,updated_by) VALUES(?,1,'moment','合成入队纪念','2022-09-01',?,2)",
).run(moment, JSON.stringify({ source: "本人补录（合成）", notes: "合成入队说明" }));
const root = resolve("public"),
  types = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
const env = {
  DB: d1(db),
  FILES: fakeBucket(),
  ENVIRONMENT: "development",
  SESSION_SECRET: "disposable-member-records-fixture",
  ASSETS: {
    fetch: async (request) => {
      const path = resolve(root, "." + decodeURIComponent(new URL(request.url).pathname));
      return path.startsWith(root + sep) && existsSync(path) && statSync(path).isFile()
        ? new Response(readFileSync(path), {
            headers: { "Content-Type": types[extname(path)] || "application/octet-stream" },
          })
        : new Response("not found", { status: 404 });
    },
  },
};
// Synthetic raster fixtures only: no photographs or private files are loaded.
const { deflateSync } = await import("node:zlib");
function fixturePng(width, height) {
  const crc = (bytes) => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const tag = Buffer.from(type),
      head = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    tail.writeUInt32BE(crc(Buffer.concat([tag, data])));
    return Buffer.concat([head, tag, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      raw[offset] = Math.round(35 + (110 * x) / width);
      raw[offset + 1] = Math.round(25 + (70 * y) / height);
      raw[offset + 2] = 45;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
for (const [status, caption] of [
  ["approved", "合成精选照片 · 舞台记忆"],
  ["pending", "合成待审核照片"],
]) {
  const id = crypto.randomUUID(),
    key = `member-photos/${id}.png`;
  await env.FILES.put(key, fixturePng(640, 420), { httpMetadata: { contentType: "image/png" } });
  db.prepare(
    "INSERT INTO member_featured_photo(id,member_id,object_key,caption,status,members_consent,updated_by) VALUES(?,1,?,?,?,1,2)",
  ).run(id, key, caption, status);
}
const sessions = {};
for (const id of [1, 2, 3, 4])
  sessions[id] = await createSession(
    { uid: id, version: 0, exp: Math.floor(Date.now() / 1000) + 7200 },
    env.SESSION_SECRET,
  );
const roles = { admin: 1, owner: 2, peer: 3, user: 4, guest: 0 };
let origin;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === "/__fixture") {
      const role = url.searchParams.get("as");
      if (role && Object.hasOwn(roles, role)) {
        res.writeHead(303, {
          Location: role === "admin" ? "/admin/graduation" : "/members/1#member-photos",
          "Set-Cookie": `fixture_role=${role}; Path=/; HttpOnly; SameSite=Strict`,
        });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        `<h1>仅合成数据验收</h1>${Object.keys(roles)
          .map((role) => `<p><a href="/__fixture?as=${role}">${role}</a></p>`)
          .join("")}`,
      );
      return;
    }
    const role = /fixture_role=(admin|owner|peer|user|guest)/.exec(req.headers.cookie || "")?.[1] || "guest",
      id = roles[role];
    const headers = new Headers(req.headers);
    headers.set("Cookie", `blackbox_csrf=records-fixture${id ? `; blackbox_session=${sessions[id]}` : ""}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const ctx = context(),
      response = await worker.fetch(
        new Request(url, {
          method: req.method,
          headers,
          ...(!["GET", "HEAD"].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
        }),
        env,
        ctx,
      );
    const outgoing = Object.fromEntries(response.headers);
    delete outgoing["content-length"];
    delete outgoing["set-cookie"];
    res.writeHead(response.status, outgoing);
    res.end(Buffer.from(await response.arrayBuffer()));
    await ctx.flush();
  } catch (error) {
    res.writeHead(500);
    res.end("Synthetic fixture failed");
    console.error(error.message);
  }
});
await new Promise((done) => server.listen(Number(process.env.MEMBER_RECORDS_PREVIEW_PORT || 8791), "127.0.0.1", done));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(`${origin}/__fixture`);
