// "Design this section's frame with the AI": the desk gives a reference graphic and its own words about how its
// graphics look, and the image model draws the FRAME of a card (art only, no text) in the desk's visual system.
//
// The model cannot be trusted to leave a transparent hole, so it is asked for a flat magenta photo area, and that
// colour is made transparent here. The headline is never drawn by the model: the card draws it where the desk chose,
// and the desk's own logo is laid on by this code, so what makes the agency recognisable cannot be misdrawn.

import sharp from "sharp";
import { head, put } from "@vercel/blob";

import { createImage, imageEnabled, ImageError, type ReferencePicture } from "@/lib/ai/image";
import type { FrameText } from "@/lib/cards/brand";

export const FRAME_W = 1080;
export const FRAME_H = 1350;

export class FrameDesignError extends Error {
  constructor(readonly kind: "off" | "refs" | "noWindow" | "busy" | "refused" | "timeout" | "failed" | "config") {
    super(`frame ${kind}`);
    this.name = "FrameDesignError";
  }
}

/** Where the empty headline band is on the finished card, as shares of its height (the card draws its text in the same boxes). */
const BAND: Record<FrameText, [number, number]> = { top: [0.13, 0.44], middle: [0.34, 0.66], bottom: [0.64, 0.93] };

/** The model draws 2:3 (1024x1536); the card is 4:5, so the picture is cropped by 135 px at the top and the bottom. */
const MODEL_H = 1620;
const CROP = (MODEL_H - FRAME_H) / 2;
/** A share of the card's height as the same place on the picture the model draws. */
const inModel = (card: number) => (card * FRAME_H + CROP) / MODEL_H;

/** The photo area may be this much of the card: less is a frame with no room for a photo, more has no frame at all. */
const WINDOW_MIN = 0.12;
const WINDOW_MAX = 0.85;
/** Time the whole design may take: the page that runs it has 60 s, and storing the result needs a few. */
const DEADLINE_MS = 56_000;
const AFTER_IMAGE_MS = 6_000;
const MIN_IMAGE_MS = 20_000;

export function framePrompt(o: {
  section: string;
  frameText: FrameText;
  designPrompt: string;
  note: string;
  hasMain: boolean;
  hasReference: boolean;
}): string {
  const [a, b] = BAND[o.frameText].map(inModel) as [number, number];
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const parts = [
    `Design the FRAME of a social-media news card (portrait). The frame surrounds a large photo area that is filled with a news photo later.`,
    `HARD RULES:`,
    `- The photo area is ONE flat, solid, pure magenta (#FF00FF) region: no text, no gradient, no texture, no border or shadow inside it. It covers all of the card that is not the headline band and not the frame's own margins and decorations.`,
    `- The headline band is empty and sits between ${pct(a)} and ${pct(b)} of the height from the top: a solid or lightly textured area with room for three lines of text.`,
    `- Draw NO text, letters, digits, logos or watermarks anywhere. The logo and the headline are added afterwards.`,
    `- Use no magenta, hot pink or purple anywhere else in the frame: that colour is reserved for the photo area.`,
    `- Keep every decoration inside the central 85% of the height: the top and bottom edges may be cropped.`,
    `This frame is for the "${o.section}" section of the news.`,
  ];
  if (o.hasMain) {
    parts.push(
      `The first reference image is the agency's MAIN frame. Keep its visual system exactly (colours, shapes, band style, margins, corner details, mood) so that every section looks like the same agency; change only a small accent that makes this section recognisable.`,
    );
  }
  if (o.hasReference) parts.push(`The other reference image is a graphic the agency wants for this section: follow its mood and structure, within the rules above.`);
  if (o.designPrompt) parts.push(`The agency's own art direction (may be in Kurdish): "${o.designPrompt}"`);
  if (o.note) parts.push(`A note for this section: "${o.note}"`);
  return parts.join("\n").slice(0, 3_000);
}

/**
 * Makes the magenta of an RGBA image transparent (pixels near #FF00FF fully, a soft edge partly). Returns the share of
 * the image that became transparent.
 */
export function keyOutMagenta(rgba: Buffer): number {
  let cleared = 0;
  const total = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const bl = rgba[i + 2];
    const d = Math.sqrt((255 - r) ** 2 + g ** 2 + (255 - bl) ** 2);
    if (d < 90) {
      rgba[i + 3] = 0;
      cleared++;
    } else if (d < 150) {
      // The edge: partly transparent, and the pink fringe pulled back towards the green channel (the grey of the edge).
      const keep = (d - 90) / 60;
      rgba[i + 3] = Math.round(rgba[i + 3] * keep);
      rgba[i] = Math.round(r * keep + g * (1 - keep));
      rgba[i + 2] = Math.round(bl * keep + g * (1 - keep));
      cleared += 1 - keep;
    }
  }
  return total ? cleared / total : 0;
}

const MAX_REF_BYTES = 12 * 1024 * 1024;

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A file of the desk's own storage, by its pathname. */
async function load(pathname: string): Promise<Buffer | null> {
  try {
    const url = (await head(pathname)).url;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    return res.ok ? await readCapped(res, MAX_REF_BYTES) : null;
  } catch {
    return null;
  }
}

async function asReference(bytes: Buffer): Promise<ReferencePicture | null> {
  try {
    const png = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return { bytes: png, mime: "image/png" };
  } catch {
    return null;
  }
}

/**
 * Designs one frame. `paths` are pathnames in the desk's own storage (checked by the caller). Returns the PNG bytes
 * (1080x1350, transparent photo area, the desk's logo laid on); the caller stores them.
 * Throws FrameDesignError. Nothing is billed unless the request reached the image service.
 */
export async function designFrame(input: {
  section: string;
  frameText: FrameText;
  designPrompt: string;
  note: string;
  mainFramePath: string | null;
  referencePath: string | null;
  logoPath: string | null;
  /** The request was sent: a failure after this point may still have been paid for. */
  onSent?: () => void;
}): Promise<Buffer> {
  const started = Date.now();
  if (!imageEnabled()) throw new FrameDesignError("off");
  // Everything the design needs from storage is read at once, before anything is sent.
  const [mainBytes, referenceBytes, logoBytes] = await Promise.all([
    input.mainFramePath ? load(input.mainFramePath) : null,
    input.referencePath ? load(input.referencePath) : null,
    input.logoPath ? load(input.logoPath) : null,
  ]);
  const refs: ReferencePicture[] = [];
  let hasMain = false;
  if (mainBytes) {
    const r = await asReference(mainBytes);
    if (r) {
      refs.push(r);
      hasMain = true;
    }
  }
  let hasReference = false;
  if (input.referencePath) {
    const r = referenceBytes ? await asReference(referenceBytes) : null;
    if (!r) throw new FrameDesignError("refs");
    refs.push(r);
    hasReference = true;
  }
  const prompt = framePrompt({ section: input.section, frameText: input.frameText, designPrompt: input.designPrompt, note: input.note, hasMain, hasReference });
  // The image call gets what is left of the page's time minus what storing the result needs; with too little left
  // it is not sent at all (and so not paid for).
  const imageMs = Math.min(55_000, DEADLINE_MS - (Date.now() - started) - AFTER_IMAGE_MS);
  if (imageMs < MIN_IMAGE_MS) throw new FrameDesignError("timeout");
  let png: Buffer;
  try {
    input.onSent?.();
    png = await createImage({ prompt, shape: "portrait", refs }, imageMs);
  } catch (e) {
    if (e instanceof ImageError) throw new FrameDesignError(e.kind);
    throw new FrameDesignError("failed");
  }
  const { data, info } = await sharp(png)
    .resize(FRAME_W, FRAME_H, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const share = keyOutMagenta(data);
  // A frame with no photo area would cover every photo, and one that is all window has no frame: neither is offered.
  if (share < WINDOW_MIN || share > WINDOW_MAX) throw new FrameDesignError("noWindow");
  // The headline band must be the frame's own, not a hole through to the photo.
  const [from, to] = BAND[input.frameText];
  let opaque = 0;
  let seen = 0;
  for (let y = Math.floor(from * info.height); y < Math.floor(to * info.height); y += 4) {
    for (let x = 0; x < info.width; x += 4) {
      seen++;
      if (data[(y * info.width + x) * 4 + 3] > 200) opaque++;
    }
  }
  if (seen && opaque / seen < 0.6) throw new FrameDesignError("noWindow");
  let out = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png();
  if (input.logoPath) {
    const b = logoBytes;
    if (b) {
      try {
        const logo = await sharp(b, { limitInputPixels: 40_000_000 }).resize({ width: 300, height: 170, fit: "inside" }).png().toBuffer();
        const meta = await sharp(logo).metadata();
        const top = input.frameText === "top" ? FRAME_H - (meta.height ?? 170) - 60 : 60;
        out = sharp(await out.toBuffer()).composite([{ input: logo, left: 64, top }]).png();
      } catch {
        /* a logo that cannot be read is left off: the frame is still the desk's */
      }
    }
  }
  return out.toBuffer();
}

/** Stores a designed frame in the desk's own folder. */
export async function storeFrame(tenantId: string, section: string, png: Buffer): Promise<string> {
  const blob = await put(`merchant/${tenantId}/frame-${section}-${Date.now()}.png`, png, {
    access: "public",
    contentType: "image/png",
    addRandomSuffix: false,
    allowOverwrite: false,
  });
  return blob.pathname;
}
