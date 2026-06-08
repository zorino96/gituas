import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire("C:/Users/Zorin/Desktop/Music Pipeline/");
const { chromium } = require("playwright");

const OUT = "C:/Users/Zorin/Desktop/gituas/public/brand";
mkdirSync(OUT, { recursive: true });

const targets = [
  { id: "#icon",    out: `${OUT}/gituas-icon.png`,        transparent: false },
  { id: "#markwrap",out: `${OUT}/gituas-mark.png`,        transparent: true  },
  { id: "#lockup",  out: `${OUT}/gituas-lockup.png`,      transparent: false },
  { id: "#board",   out: `${OUT}/gituas-logo-board.png`,  transparent: false },
];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ deviceScaleFactor: 3 });
await page.goto("file:///C:/Users/Zorin/Desktop/gituas/scripts/logo.html", {
  waitUntil: "networkidle",
  timeout: 60000,
});
await page.evaluate(async () => { await document.fonts.ready; });
await page.waitForTimeout(1200);

for (const t of targets) {
  const el = page.locator(t.id);
  await el.screenshot({ path: t.out, omitBackground: t.transparent });
  console.log("rendered:", t.out);
}

await browser.close();
console.log("done");
