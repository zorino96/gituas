"use server";

import { put } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import sharp from "sharp";

import { createImage, ImageError, imageEnabled, type ReferencePicture } from "@/lib/ai/image";
import { reviewIdea, ReviewFailed } from "@/lib/ai/review-idea";
import { claimSlot, IMAGE_SLOTS, refundSlot, slotsUsed } from "@/lib/ai/slots";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { isOwnBlobUrl } from "@/lib/merchant/caption";
import { can } from "@/lib/newsroom/roles";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { currentWorkspace } from "@/app/app/data";

export type AiImageResult =
  | {
      ok: true;
      media: { url: string; pathname: string; type: "IMAGE" };
      /** What the image model was asked, so the owner can see it. */
      prompt: string;
      /** Whether Gituas reviewed the idea first (false: it went exactly as written). */
      reviewed: boolean;
      summary: string;
    }
  | { ok: false; error: string };

/** The publish page's own limit is 60 s (maxDuration); the action leaves a margin for storing the picture. */
const DEADLINE_MS = 56_000;
const MAX_REF_BYTES = 12 * 1024 * 1024;
const MAX_REFS = 4;

/** The response body, or null as soon as it is (or says it is) bigger than `max` bytes: the size is checked while reading. */
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

/** A reference picture: fetched from the workspace's own storage, made upright and no bigger than 1536 px, as JPEG. */
async function loadReference(url: string): Promise<ReferencePicture | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const bytes = await readCapped(res, MAX_REF_BYTES);
    if (!bytes) return null;
    const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    return { bytes: jpeg, mime: "image/jpeg" };
  } catch {
    return null;
  }
}

/**
 * Makes one picture with the AI for the post being written, from the owner's idea, the product's own
 * photo and up to three reference pictures. The picture is stored in the workspace's own folder as a
 * JPEG (Instagram takes nothing else) and handed back as the post's media.
 */
export async function generateAiImageAction(input: {
  idea: string;
  productId: string | null;
  refUrls: string[];
  shape: "square" | "portrait";
  /** Let Gituas review and improve the idea first (default: yes). Off: the words go to the image model as typed. */
  review?: boolean;
}): Promise<AiImageResult> {
  const started = Date.now();
  const lang = await getLang();
  const [ws, t] = [await currentWorkspace(), dict(lang)];
  const e = t.publish.ai.errors;
  if (!ws) return { ok: false, error: e.signIn };
  if (ws.kind !== "MERCHANT" || !can(ws.role, "publish")) return { ok: false, error: e.notAllowed };
  if (!imageEnabled()) return { ok: false, error: e.off };
  const idea = typeof input.idea === "string" ? input.idea.trim() : "";
  if (idea.length < 3) return { ok: false, error: e.idea };

  const limits = await limitsOf(ws.id);
  if (limits.images <= 0) return { ok: false, error: e.paid };
  // Before any picture is downloaded or decoded: a used-up day or month answers straight away.
  const used = await slotsUsed(ws.id, IMAGE_SLOTS);
  if (used.month >= limits.images) return { ok: false, error: e.limit };
  if (used.day >= limits.imagesPerDay) return { ok: false, error: e.daily };

  const product = input.productId
    ? await db.product.findFirst({ where: { id: input.productId, store: { tenantId: ws.id }, active: true }, select: { name: true, description: true, photos: true, storeId: true } })
    : null;

  // The references: the product's own first photo, then what the owner uploaded for this picture.
  const urls: string[] = [];
  const firstPhoto = product?.photos.find((u) => isOwnBlobUrl(u, ws.id));
  if (firstPhoto) urls.push(firstPhoto);
  for (const u of Array.isArray(input.refUrls) ? input.refUrls : []) {
    if (typeof u === "string" && isOwnBlobUrl(u, ws.id) && !urls.includes(u)) urls.push(u);
    if (urls.length >= MAX_REFS) break;
  }
  const loaded = (await Promise.all(urls.map(loadReference))).filter((r): r is ReferencePicture => !!r);
  if (urls.length > 0 && loaded.length === 0) return { ok: false, error: e.refs };

  // The review comes before a place is taken: if it cannot be done the owner loses nothing, and chooses.
  const shape = input.shape === "portrait" ? "portrait" : "square";
  let prompt = idea;
  let reviewed = false;
  let summary = "";
  if (input.review !== false) {
    try {
      const storeId = product?.storeId ?? (await db.store.findFirst({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" }, select: { id: true } }).catch(() => null))?.id ?? null;
      const r = await reviewIdea({ tenantId: ws.id, storeId, productId: input.productId, idea, kind: "image", lang, refCount: loaded.length, shape });
      prompt = r.text;
      summary = r.summary;
      reviewed = !r.kept;
    } catch (err) {
      if (err instanceof ReviewFailed) return { ok: false, error: e.reviewFailed };
      throw err;
    }
  }

  // A place in the day and the month, taken before the money is spent.
  const slot = await claimSlot(ws.id, IMAGE_SLOTS, { month: limits.images, day: limits.imagesPerDay });
  if (!slot.ok) return { ok: false, error: slot.error === "daily" ? e.daily : e.limit };

  // Once the request has gone to OpenAI the picture may be paid for even when it never reaches us (a
  // timeout, a failure after the answer), so the place only goes back when nothing can have been billed:
  // the request was never sent, or OpenAI refused it outright (busy, refused, not configured).
  let sent = false;
  try {
    // The page has a minute in all: the picture gets what is left of it (and is not started with too little).
    const left = DEADLINE_MS - (Date.now() - started);
    if (left < 15_000) throw new ImageError("timeout");
    sent = true;
    const png = await createImage({ prompt, shape, refs: loaded }, Math.min(45_000, left));
    // Instagram's feed takes 4:5 at the tallest: the tall picture is made 2:3 and cropped from the middle.
    const shaped = input.shape === "portrait" ? sharp(png).resize(1024, 1280, { fit: "cover", position: "centre" }) : sharp(png);
    const jpeg = await shaped.jpeg({ quality: 90 }).toBuffer();
    const pathname = `merchant/${ws.id}/ai-${Date.now()}.jpg`;
    const blob = await put(pathname, jpeg, { access: "public", contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: false });
    // The composer's "left" numbers come from the page: ask it to read them again.
    try {
      revalidatePath("/app/publish");
    } catch {
      /* outside a request (tests) */
    }
    return { ok: true, media: { url: blob.url, pathname: blob.pathname, type: "IMAGE" }, prompt, reviewed, summary };
  } catch (err) {
    const unbilled = !sent || (err instanceof ImageError && (err.kind === "busy" || err.kind === "refused" || err.kind === "config"));
    if (unbilled) await refundSlot(ws.id, IMAGE_SLOTS, slot).catch(() => undefined);
    if (err instanceof ImageError) {
      const byKind = { busy: e.busy, refused: e.refused, config: e.off, failed: e.failed, timeout: e.timeout } as const;
      return { ok: false, error: byKind[err.kind] };
    }
    console.error("[ai-image] failed:", err instanceof Error ? err.message.slice(0, 160) : "unknown error");
    return { ok: false, error: e.failed };
  }
}
