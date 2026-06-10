// Re-encodes the screen recording in Chrome via captureStream + MediaRecorder:
//  - target bitrate ~4.5 Mbps (≈36 MB for 64s, under TikTok's 50 MB cap)
//  - skips 21.5s→27s (new-tab search-history moment)
//  - tries MP4 (avc1) first, falls back to WebM (vp9)
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("C:/Users/Zorin/Desktop/Music Pipeline/");
const { chromium } = require("playwright");

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("file:///C:/Users/Zorin/Desktop/gituas/scripts/check-recording.html");
await page.waitForFunction(() => { const v = document.getElementById("v"); return v && v.readyState >= 2; }, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const v = document.getElementById("v");
  v.muted = false; v.volume = 1; // keep audio track if present
  const stream = v.captureStream();
  const mime = ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_500_000, audioBitsPerSecond: 128_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });

  // skip the search-history segment
  v.addEventListener("timeupdate", () => {
    if (v.currentTime >= 21.5 && v.currentTime < 31.5) v.currentTime = 31.5;
  });

  rec.start(1000);
  await v.play();
  await new Promise((res) => v.addEventListener("ended", res, { once: true }));
  rec.stop();
  await done;

  const blob = new Blob(chunks, { type: mime });
  const buf = await blob.arrayBuffer();
  let bin = ""; const bytes = new Uint8Array(buf); const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return { mime, size: blob.size, b64: btoa(bin) };
});

const ext = result.mime.includes("mp4") ? "mp4" : "webm";
const out = `C:/Users/Zorin/Desktop/gituas/scripts/gituas-demo.${ext}`;
writeFileSync(out, Buffer.from(result.b64, "base64"));
console.log("mime:", result.mime);
console.log("size:", (result.size / 1024 / 1024).toFixed(1), "MB");
console.log("saved:", out);
await browser.close();
