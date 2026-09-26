import { toPng } from "html-to-image";

import { CARD_H, CARD_W } from "./templates";

/**
 * Paint a card node into a PNG in the browser. The browser shapes the
 * Kurdish text, so it comes out exactly as it looks on screen.
 */
export async function renderCardPng(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const dataUrl = await toPng(node, { width: CARD_W, height: CARD_H, pixelRatio: 1, cacheBust: true });
  return await (await fetch(dataUrl)).blob();
}
