// The card as a JPEG, made on the server: headless Chromium opens the render page
// (/newsroom/card-render/[id]) and screenshots it. A real browser, because nothing
// else shapes Kurdish text the way the editor's own preview does.
import { existsSync } from "node:fs";

import { del, put } from "@vercel/blob";
import puppeteer, { type Browser } from "puppeteer-core";

import { db } from "@/lib/db";
import { checkDraft } from "@/lib/news/rules";
import { signRenderToken } from "./render-token";
import { CARD_H, CARD_W } from "./size";

const VIEWPORT = { width: CARD_W, height: CARD_H, deviceScaleFactor: 1 };
const RENDER_TIMEOUT_MS = 25_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const STEP_TIMEOUT_MS = 15_000;

/** A Chrome on this machine: CHROME_PATH first, then where each system usually keeps it. */
function localChrome(): string {
  const byPlatform: Record<string, string[]> = {
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  };
  const found = [process.env.CHROME_PATH, ...(byPlatform[process.platform] ?? [])].find((p) => !!p && existsSync(p));
  if (!found) throw new Error("Chrome was not found. Set CHROME_PATH to a Chrome or Chromium executable.");
  return found;
}

async function launch(): Promise<Browser> {
  if (process.env.VERCEL) {
    // Vercel has no Chrome: @sparticuz/chromium unpacks one built for serverless.
    const { default: chromium } = await import("@sparticuz/chromium");
    return puppeteer.launch({
      args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      executablePath: await chromium.executablePath(),
      headless: "shell",
      defaultViewport: VIEWPORT,
      timeout: LAUNCH_TIMEOUT_MS,
    });
  }
  return puppeteer.launch({ executablePath: localChrome(), headless: true, defaultViewport: VIEWPORT, timeout: LAUNCH_TIMEOUT_MS });
}

/**
 * Runs in the page, so it is a string: nothing the bundler does to this file can reach it.
 * Loads the fonts the card's own text needs, waits for its images, lets the headline fit
 * itself once more, then says what it sees.
 */
const SETTLE = `(async () => {
  const card = document.getElementById("card");
  if (!card) return { found: false };
  const loads = [];
  for (const el of card.querySelectorAll("*")) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    loads.push(document.fonts.load(cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily, own));
  }
  const faces = (await Promise.all(loads)).reduce((n, list) => n + list.length, 0);
  await document.fonts.ready;
  const images = await Promise.all(Array.from(card.querySelectorAll("img")).map((img) =>
    img.complete
      ? img.naturalWidth > 0
      : new Promise((done) => {
          img.addEventListener("load", () => done(true), { once: true });
          img.addEventListener("error", () => done(false), { once: true });
        }),
  ));
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null))));
  const box = card.getBoundingClientRect();
  return {
    found: true,
    faces,
    imagesOk: images.every(Boolean),
    overflow: !!card.querySelector('[data-overflow="1"]'),
    box: [box.left, box.top, box.width, box.height],
  };
})()`;

interface Settled {
  found: boolean;
  faces?: number;
  imagesOk?: boolean;
  overflow?: boolean;
  box?: number[];
}

async function shoot(browser: Browser, url: string): Promise<Buffer> {
  const page = await browser.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  await page.setViewport(VIEWPORT);
  const res = await page.goto(url, { waitUntil: "load", timeout: STEP_TIMEOUT_MS });
  if (!res || !res.ok()) throw new Error(`The card page answered ${res ? res.status() : "nothing"}.`);
  // The headline carries data-overflow once the card has run in the browser and fitted its text.
  await page.waitForSelector("#card [data-overflow]");
  const state = (await page.evaluate(SETTLE)) as Settled;
  if (!state.found) throw new Error("The card page has no card.");
  if (!state.faces) throw new Error("The card's fonts did not load.");
  if (!state.imagesOk) throw new Error("An image on the card did not load.");
  if (state.overflow) throw new Error("The headline is too long for the card.");
  if (state.box?.join() !== [0, 0, CARD_W, CARD_H].join()) throw new Error(`The card is not ${CARD_W}×${CARD_H} at the page's corner.`);
  const card = await page.$("#card");
  if (!card) throw new Error("The card page has no card.");
  return Buffer.from(await card.screenshot({ type: "jpeg", quality: 92 }));
}

/** Close the browser whatever happened to the render; kill it if it will not close. */
async function shutdown(launching: Promise<Browser>): Promise<void> {
  try {
    const browser = await launching;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([browser.close(), new Promise((done) => (timer = setTimeout(done, 3000)))]).finally(() => clearTimeout(timer));
    browser.process()?.kill("SIGKILL");
  } catch {
    // It never started, or is already gone.
  }
}

/**
 * The end of the line of renders in this function instance. @sparticuz/chromium unpacks its
 * browser into /tmp on first use, and a second launch beside it can find the binary half
 * written; three browsers at once also need three times the memory. A render that fails
 * still lets the next one through.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The draft's card as a 1080×1350 JPEG (quality 92): the same card the editor shows.
 *
 * `origin` is where this app answers, without a path, and it must be an origin that serves
 * /newsroom pages itself. In production that is NEWSROOM_ORIGIN (https://hawalnoos.com):
 * the shop domain and both www hosts redirect /newsroom/* away (src/lib/hosts.ts), and the
 * card's logo and photo are fetched from the same origin through /m/. Locally it is the dev
 * server, for example http://localhost:3001.
 *
 * Throws when the page, its fonts or an image do not load, when the headline does not fit,
 * or after 25 seconds. The browser is always closed.
 *
 * One browser at a time: a render asked for while another is running waits for it to end, and
 * its own 25 seconds only start then.
 */
export function renderCardServer(draftId: string, origin: string): Promise<Buffer> {
  const mine = queue.then(() => renderNow(draftId, origin));
  queue = mine.catch(() => undefined);
  return mine;
}

async function renderNow(draftId: string, origin: string): Promise<Buffer> {
  const url = `${origin.replace(/\/+$/, "")}/newsroom/card-render/${encodeURIComponent(draftId)}?t=${signRenderToken(draftId)}`;
  const launching = launch();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      launching.then((browser) => shoot(browser, url)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Rendering the card took longer than 25 seconds.")), RENDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    await shutdown(launching);
  }
}

/**
 * Render the draft's card, store it and attach it to the draft, as the editor's "prepare"
 * does by hand. The desk rules are checked first, as attachCardAction does, and the card
 * is only attached when the draft's text did not change while it was being rendered: a
 * stale card must never go out with new text. `origin` as for renderCardServer.
 *
 * Returns, with the stored card, the headline and body it was rendered from: whoever posts the
 * card must take the caption from these, not from a copy of the draft read earlier.
 */
export async function renderAndStoreCard(
  draftId: string,
  tenantId: string,
  origin: string,
): Promise<{ url: string; pathname: string; headline: string; body: string }> {
  const draft = await db.newsDraft.findFirst({
    where: { id: draftId, tenantId },
    select: { headline: true, body: true, updatedAt: true, item: { select: { title: true, snippet: true } } },
  });
  if (!draft) throw new Error("The draft was not found on this desk.");
  const problems = checkDraft(draft, draft.item);
  if (problems.length) throw new Error(`The draft breaks the desk rules: ${problems.map((p) => p.code).join(", ")}.`);

  const jpeg = await renderCardServer(draftId, origin);
  const blob = await put(`merchant/${tenantId}/news-card-${Date.now()}.jpg`, jpeg, { access: "public", contentType: "image/jpeg" });
  const { count } = await db.newsDraft.updateMany({
    where: { id: draftId, tenantId, updatedAt: draft.updatedAt },
    data: { cardUrl: blob.url, cardPath: blob.pathname },
  });
  if (count === 0) {
    await del(blob.url).catch(() => undefined);
    throw new Error("The draft changed while its card was being rendered.");
  }
  return { url: blob.url, pathname: blob.pathname, headline: draft.headline, body: draft.body };
}
