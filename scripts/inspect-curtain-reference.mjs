import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const dir = "docs/evidence/2026-09-19-curtain-folds";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {}),
});
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
  await page.setContent(
    '<body style="margin:0;background:black"><video muted preload="auto" style="width:100%;height:100vh;object-fit:contain" src="https://videos.pexels.com/video-files/6899898/6899898-uhd_2160_4096_25fps.mp4"></video></body>',
  );
  await page.waitForFunction(() => document.querySelector("video").readyState >= 2, null, { timeout: 45000 });
  console.log(
    await page.locator("video").evaluate((v) => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight })),
  );
  for (const time of [6, 8, 10, 12]) {
    await page.locator("video").evaluate(async (v, t) => {
      v.currentTime = t + 0.01;
      await new Promise((resolve) => v.addEventListener("seeked", resolve, { once: true }));
    }, time);
    await page.screenshot({ path: dir + "/reference-" + time + ".png" });
  }
} finally {
  await browser.close();
}
