import { toJpeg } from "html-to-image";

import { CARD_H, CARD_W } from "./templates";

/**
 * Paint a card node into a JPEG in the browser. The browser shapes the
 * Kurdish text, so it comes out exactly as it looks on screen. JPEG because
 * TikTok's photo posts and Instagram only accept JPEG (WebP also works for
 * TikTok, but not Instagram).
 */
export async function renderCardJpeg(node: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const dataUrl = await toJpeg(node, {
    width: CARD_W,
    height: CARD_H,
    pixelRatio: 1,
    cacheBust: true,
    quality: 0.92,
    // html-to-image paints this onto the card's own root, replacing its
    // background — a fixed white here turned every card white. JPEG has no
    // transparency, so use the card's own colour.
    backgroundColor: getComputedStyle(node).backgroundColor,
  });
  return await (await fetch(dataUrl)).blob();
}
