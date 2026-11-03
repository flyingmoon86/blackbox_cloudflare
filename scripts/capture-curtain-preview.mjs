import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const { navigationFixture } = await import(pathToFileURL(resolve("scripts/navigation-fixture.mjs")).href);
const { chromium } = await import(
  pathToFileURL(
    "C:/Users/gbg61/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  ).href
);
const out = resolve(process.env.CURTAIN_CAPTURE_EVIDENCE || "artifacts/working/2026-11-03-curtain-opening/render");
const variant = "capture-" + new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const mobile = process.argv.includes("--mobile");
const label = process.argv.find((a) => a.startsWith("--label="))?.slice(8) || variant;
if (!/^[a-z0-9_-]+$/i.test(label)) throw Error("Use only letters, numbers, underscores and hyphens in --label");
const name = label + (mobile ? "-mobile" : "-desktop");
const dir = resolve(out, "frames", name);
if (existsSync(dir)) throw Error("Capture already exists; use a new --label");
mkdirSync(dir, { recursive: true });
const fixture = await navigationFixture();
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 };
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const client = await ctx.newCDPSession(page);
  const frames = [];
  client.on("Page.screencastFrame", (e) => {
    const path = resolve(dir, String(frames.length).padStart(5, "0") + ".jpg");
    writeFileSync(path, Buffer.from(e.data, "base64"));
    frames.push({ path, timestamp: e.metadata.timestamp });
    client.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
  });
  await client.send("Page.enable");
  await client.send("Performance.enable");
  await client.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame",
    transferMode: "ReturnAsStream",
  });
  await client.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  });
  await page.addInitScript(() => {
    window.__capture = {};
    document.addEventListener("animationstart", (e) => {
      if (e.animationName === "curtain-reveal-left")
        window.__capture.start = (performance.timeOrigin + performance.now()) / 1000;
    });
    document.addEventListener(
      "blackbox:curtain-finished",
      () => (window.__capture.end = (performance.timeOrigin + performance.now()) / 1000),
    );
  });
  await page.goto(fixture.origin, { waitUntil: "domcontentloaded" });
  const ready = await page.evaluate(() => window.blackboxNavigation.startupPromise);
  assert.equal(ready.status, "ready");
  await page.waitForSelector(".blackbox-curtain", { state: "detached", timeout: 15000 });
  await page.waitForTimeout(150);
  const times = await page.evaluate(() => window.__capture);
  const metrics = await client.send("Performance.getMetrics");
  await client.send("Page.stopScreencast");
  const traceDone = new Promise((resolve) => client.once("Tracing.tracingComplete", resolve));
  await client.send("Tracing.end");
  const { stream } = await traceDone;
  let raw = "";
  for (;;) {
    const chunk = await client.send("IO.read", { handle: stream });
    raw += chunk.data;
    if (chunk.eof) break;
  }
  await client.send("IO.close", { handle: stream });
  const traced = JSON.parse(raw).traceEvents;
  const nav = await page.evaluate(() => performance.timeOrigin);
  // CDP metrics and tracing share a monotonic clock.
  const navigationStart = metrics.metrics.find((m) => m.name === "NavigationStart").value;
  const traceStart = (navigationStart + times.start - nav / 1000) * 1000000,
    traceEnd = (navigationStart + times.end - nav / 1000) * 1000000;
  const paints = traced.filter(
    (e) =>
      e.ts >= traceStart &&
      e.ts <= traceEnd &&
      ["Paint", "RasterTask", "UpdateLayoutTree", "Layout", "CompositeLayers", "DrawFrame"].includes(e.name),
  );
  const counts = {};
  for (const e of paints) {
    const x = (counts[e.name] ??= { count: 0, durationMs: 0 });
    x.count++;
    x.durationMs += (e.dur || 0) / 1000;
  }
  const chosen = frames.filter((f) => f.timestamp >= times.start - 0.12 && f.timestamp <= times.end + 0.06);
  const moving = frames.filter((f) => f.timestamp >= times.start && f.timestamp <= times.end);
  const intervals = moving
    .slice(1)
    .map((f, i) => 1000 * (f.timestamp - moving[i].timestamp))
    .sort((a, b) => a - b);
  const lines = ["ffconcat version 1.0"];
  for (let i = 0; i < chosen.length; i++) {
    lines.push("file '" + chosen[i].path.replaceAll("\\", "/") + "'", "option framerate 1000");
    if (i < chosen.length - 1) lines.push("duration " + Math.max(0.001, chosen[i + 1].timestamp - chosen[i].timestamp));
  }
  if (chosen.length) lines.push("file '" + chosen.at(-1).path.replaceAll("\\", "/") + "'", "option framerate 1000");
  const concat = resolve(out, name + ".ffconcat");
  writeFileSync(concat, lines.join("\n"));
  const video = resolve(out, name + ".mp4");
  const encoded = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concat,
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-fps_mode",
      "vfr",
      "-enc_time_base",
      "1:1000",
      "-video_track_timescale",
      "60000",
      "-movflags",
      "+faststart",
      video,
    ],
    { encoding: "utf8" },
  );
  assert.equal(encoded.status, 0, encoded.stderr);
  const preview = resolve(out, name + "-60.mp4");
  const delivery = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      video,
      "-vf",
      "fps=60",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      preview,
    ],
    { encoding: "utf8" },
  );
  assert.equal(delivery.status, 0, delivery.stderr);
  const uniqueMovingFrames = new Set(moving.map((f) => createHash("sha256").update(readFileSync(f.path)).digest("hex")))
    .size;
  const result = {
    name,
    viewport,
    preview,
    uniqueMovingFrames,
    deliveryFPS: 60,
    deliveryMethod:
      "sample/hold original captured frames at 60Hz; no motion interpolation; source capture FPS below is authoritative",
    scope: "独立本地合成Worker；CDP实际合成帧+原始时间戳VFR编码，无插帧，无把25fps升帧",
    times,
    rawMovingFrames: moving.length,
    observedCaptureFPS: (moving.length - 1) / (moving.at(-1).timestamp - moving[0].timestamp),
    medianFrameIntervalMs: intervals[Math.floor(intervals.length / 2)],
    p95FrameIntervalMs: intervals[Math.floor(intervals.length * 0.95)],
    maxFrameIntervalMs: intervals.at(-1),
    traceScope: "reveal only, anchored to CDP NavigationStart + browser performance.timeOrigin",
    traceCounts: counts,
    video,
    frames: moving,
  };
  writeFileSync(resolve(out, name + ".json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, frames: undefined }));
  await ctx.close();
} finally {
  await browser.close();
  await fixture.close();
}
