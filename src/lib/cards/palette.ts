// Colours from a channel's own images (a logo, a studio photo, an old card),
// for its brand kit: the few colours an image is mostly made of, and which
// text colour reads best on a background.

type Rgb = [number, number, number];

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function fromHex(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Colours closer than this count as one shade. */
const SAME_SHADE = 48;

/**
 * The main colours of an RGBA pixel buffer, most common first. Pixels are
 * grouped into 4-bit-per-channel buckets and averaged; see-through pixels are
 * skipped (a logo's transparent background isn't a brand colour); a shade too
 * close to one already chosen is merged, so the palette isn't six blues.
 */
export function dominantColors(rgba: Uint8ClampedArray, count = 6): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const e = buckets.get(key);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }
  const chosen: Rgb[] = [];
  for (const e of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const c: Rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
    if (chosen.some((o) => distance(o, c) < SAME_SHADE)) continue;
    chosen.push(c);
    if (chosen.length === count) break;
  }
  return chosen.map(([r, g, b]) => toHex(r, g, b));
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = fromHex(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** White or near-black text, whichever has more contrast on this background. */
export function readableOn(background: string): "#ffffff" | "#111111" {
  const bg = luminance(background);
  return contrast(bg, 1) >= contrast(bg, luminance("#111111")) ? "#ffffff" : "#111111";
}
