import { createRequire } from "node:module";
const require = createRequire("C:/Users/Zorin/Desktop/Music Pipeline/");
const { chromium } = require("playwright");

const shots = [
  { url: "http://localhost:3001/", out: "C:/Users/Zorin/Desktop/gituas/scripts/shot-landing.png", full: true },
  { url: "http://localhost:3001/", out: "C:/Users/Zorin/Desktop/gituas/scripts/shot-hero.png", full: false },
  { url: "http://localhost:3001/login", out: "C:/Users/Zorin/Desktop/gituas/scripts/shot-login.png", full: false },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

for (const s of shots) {
  await page.goto(s.url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2600); // let count-up + reveals settle
  await page.screenshot({ path: s.out, fullPage: s.full });
  console.log("shot:", s.out);
}

await browser.close();
console.log("done");
