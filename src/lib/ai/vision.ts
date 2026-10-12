// A picture, made small enough to hand to the model: fetched, turned upright and cut to 768 px on
// its long side as a JPEG data URL (kurd.gg takes pictures as data URLs). About 800 tokens each.

import sharp from "sharp";

const MAX_BYTES = 18 * 1024 * 1024;

export async function imageDataUrl(url: string, opts: { timeoutMs?: number } = {}): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000) });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) return null;
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}
