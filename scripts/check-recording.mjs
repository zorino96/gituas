// Extracts a few frames from the screen recording via Chrome <video> + screenshots.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("C:/Users/Zorin/Desktop/Music Pipeline/");
const { chromium } = require("playwright");

const OUT = "C:/Users/Zorin/Desktop/gituas/scripts/frames";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("file:///C:/Users/Zorin/Desktop/gituas/scripts/check-recording.html");
await page.waitForFunction(() => { const v = document.getElementById("v"); return v && v.readyState >= 2; }, { timeout: 30000 });
const dur = await page.evaluate(() => document.getElementById("v").duration);
console.log("duration:", dur.toFixed(1), "s");

const stamps = [2, 12, 24, 36, 48, 58, Math.max(0, dur - 2)];
for (const t of stamps) {
  await page.evaluate(async (tt) => {
    const v = document.getElementById("v");
    v.currentTime = tt;
    await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
  }, t);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/frame-${String(Math.round(t)).padStart(3, "0")}.png` });
  console.log("frame at", t);
}
await browser.close();
console.log("done");
