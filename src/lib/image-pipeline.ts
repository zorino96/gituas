import sharp from "sharp";

// ---------------------------------------------------------------------------
//  Image pipeline — one source → 4 aspect ratio variants
// ---------------------------------------------------------------------------
//
//  Signature MANUAL feature: upload one image, get clean crops for every major
//  platform's preferred ratio (Instagram feed, Story/Reel, YouTube/X/LinkedIn).
//
//  Strategy: rely on Sharp's "attention" strategy (saliency-based) which picks
//  the most interesting region of the source automatically. Future Smart Crop
//  v2 will replace this with Gemini Vision bounding boxes.

export const ASPECT_RATIOS = {
  RATIO_16_9: { width: 1920, height: 1080, label: "16:9 — YouTube / X / LinkedIn" },
  RATIO_9_16: { width: 1080, height: 1920, label: "9:16 — TikTok / Reels / Stories" },
  RATIO_1_1: { width: 1080, height: 1080, label: "1:1 — Instagram feed / X" },
  RATIO_4_5: { width: 1080, height: 1350, label: "4:5 — Instagram portrait" },
} as const;

export type AspectRatioKey = keyof typeof ASPECT_RATIOS;

export interface VariantBuffer {
  ratio: AspectRatioKey;
  buffer: Buffer;
  mime: "image/jpeg";
  width: number;
  height: number;
  bytes: number;
}

export async function buildAllVariants(source: Buffer): Promise<VariantBuffer[]> {
  const out: VariantBuffer[] = [];
  for (const ratio of Object.keys(ASPECT_RATIOS) as AspectRatioKey[]) {
    const spec = ASPECT_RATIOS[ratio];
    const buf = await sharp(source)
      .resize(spec.width, spec.height, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
    out.push({
      ratio,
      buffer: buf,
      mime: "image/jpeg",
      width: spec.width,
      height: spec.height,
      bytes: buf.byteLength,
    });
  }
  return out;
}

export function bufferToDataUrl(buf: Buffer, mime = "image/jpeg"): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}
