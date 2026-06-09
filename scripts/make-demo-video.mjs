// Generates a short vertical (1080x1920) demo clip of the NOCTURNE landing
// page using Playwright's built-in video recording (no ffmpeg needed).
// Output: public/demo/sample.webm — TikTok PULL_FROM_URL accepts WebM.
import { createRequire } from "node:module";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
const require = createRequire("C:/Users/Zorin/Desktop/Music Pipeline/");
const { chromium } = require("playwright");

const OUT_DIR = "C:/Users/Zorin/Desktop/gituas/public/demo";
const TMP_DIR = `${OUT_DIR}/.rec`;
mkdirSync(OUT_DIR, { recursive: true });
rmSync(TMP_DIR, { recursive: true, force: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  recordVideo: { dir: TMP_DIR, size: { width: 1080, height: 1920 } },
});
const page = await ctx.newPage();

await page.goto("https://gituas.vercel.app/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500); // hero + count-up settle

// slow cinematic scroll through the page
await page.evaluate(async () => {
  const total = Math.min(document.body.scrollHeight - innerHeight, 4200);
  const steps = 90;
  for (let i = 0; i <= steps; i++) {
    scrollTo({ top: (total * i) / steps, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 55));
  }
  // glide back up to the moon
  scrollTo({ top: 0, behavior: "smooth" });
});
await page.waitForTimeout(2500);

await ctx.close(); // flushes the video file
await browser.close();

// move the recording to its final name
const file = readdirSync(TMP_DIR).find((f) => f.endsWith(".webm"));
if (!file) throw new Error("no recording produced");
renameSync(`${TMP_DIR}/${file}`, `${OUT_DIR}/sample.webm`);
rmSync(TMP_DIR, { recursive: true, force: true });
console.log("created public/demo/sample.webm");
