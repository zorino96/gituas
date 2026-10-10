// One Studio picture from start to finish.
//
//   startImage    take the price from the prepaid balance, send photo + scene         QUEUED → RUNNING
//   advanceAsset  (webhook or the minute clock) ask Higgsfield for the real state;
//                 when done, copy the picture to our Blob and draw the ad on it      RUNNING → RENDERING → DONE
//   failAsset     failed or blocked by moderation: the price goes back              → FAILED | BLOCKED
//
// Every step claims its row with a conditional update, so the webhook and the clock can meet on
// the same picture without doing the work twice.

import { del, put } from "@vercel/blob";

import { signRenderToken } from "@/lib/cards/render-token";
import { renderUrlServer } from "@/lib/cards/server-render";
import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { randomUUID } from "node:crypto";

import { imagePrice } from "./pricing";
import { chargeWallet, refundWallet } from "./wallet";
import { generationStatus, HiggsfieldError, higgsfieldConfigured, submitGeneration, webhookToken } from "./higgsfield";
import { ASPECT_PX, imageArgs, imageModel, isStudioAspect, studioPrompt, type StudioAspect, type StudioPreset } from "./presets";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** A picture Higgsfield has not finished after this long is given up, and its credit returned. */
export const GIVE_UP_MS = 2 * 3_600_000;

/** Where our render page is opened: the shop's own domain in production. */
export function studioOrigin(): string {
  if (process.env.NODE_ENV === "production") return SHOP_ORIGIN;
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "http://localhost:3001";
}

export type StartFailure = "not_ready" | "no_balance" | HiggsfieldError["reason"];

export async function startImage(input: {
  tenantId: string;
  productId: string | null;
  sourceUrl: string;
  preset: StudioPreset;
  aspect: StudioAspect;
  headline: string;
  showPrice: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; reason: StartFailure }> {
  const model = imageModel();
  if (!higgsfieldConfigured() || !model) return { ok: false, reason: "not_ready" };
  // Paid first: the price comes off the shop's prepaid balance before Higgsfield is asked for anything.
  const { priceIqd, costUsd } = imagePrice();
  const id = randomUUID();
  if (!(await chargeWallet(input.tenantId, priceIqd, id))) return { ok: false, reason: "no_balance" };

  const prompt = studioPrompt(input.preset);
  const asset = await db.studioAsset.create({
    data: { id, ...input, kind: "IMAGE", model, prompt, priceIqd, costUsd, status: "QUEUED" },
    select: { id: true },
  });
  try {
    const { requestId } = await submitGeneration(model, imageArgs(prompt, input.sourceUrl, input.aspect), {
      webhookUrl: `${studioOrigin()}/api/webhooks/higgsfield?t=${webhookToken()}`,
      idempotencyKey: `studio-${asset.id}`,
    });
    await db.studioAsset.update({ where: { id: asset.id }, data: { requestId, status: "RUNNING" } });
    return { ok: true, id: asset.id };
  } catch (e) {
    const reason = e instanceof HiggsfieldError ? e.reason : "unavailable";
    await failAsset(asset.id, "FAILED", e instanceof Error ? e.message : "could not start");
    return { ok: false, reason };
  }
}

/** Mark a picture failed (or blocked by moderation) once, and give its price back. */
export async function failAsset(id: string, status: "FAILED" | "BLOCKED", error: string): Promise<void> {
  const a = await db.studioAsset.findUnique({ where: { id }, select: { tenantId: true, priceIqd: true } });
  if (!a) return;
  const r = await db.studioAsset.updateMany({
    where: { id, status: { in: ["QUEUED", "RUNNING", "RENDERING"] } },
    data: { status, error: error.slice(0, 300) },
  });
  if (r.count === 1) await refundWallet(a.tenantId, a.priceIqd, id);
}

function extOf(contentType: string | null): { ext: string; type: string } | null {
  const t = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return { ext: "jpg", type: "image/jpeg" };
  if (t === "image/png") return { ext: "png", type: "image/png" };
  if (t === "image/webp") return { ext: "webp", type: "image/webp" };
  return null;
}

/** Copy Higgsfield's picture to our Blob (it keeps files only about a week). */
async function keepRaw(tenantId: string, id: string, url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Downloading the picture answered ${res.status}.`);
  const kind = extOf(res.headers.get("content-type"));
  if (!kind) throw new Error("The picture is not a JPEG, PNG or WebP.");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("The picture is too large.");
  const blob = await put(`merchant/${tenantId}/studio/${id}-raw.${kind.ext}`, buf, { access: "public", contentType: kind.type, addRandomSuffix: true });
  return blob.pathname;
}

/**
 * Draw the ad (brand, headline, price) on the kept picture and store it. Throws when the render
 * fails — for example a headline too long to fit — and leaves the previous ad in place.
 */
export async function renderFinal(id: string): Promise<{ url: string; pathname: string }> {
  const a = await db.studioAsset.findUnique({ where: { id }, select: { tenantId: true, aspect: true, rawPath: true, finalUrl: true } });
  if (!a?.rawPath || !isStudioAspect(a.aspect)) throw new Error("The picture is not ready.");
  const url = `${studioOrigin()}/studio-render/${encodeURIComponent(id)}?t=${signRenderToken(`studio:${id}`)}`;
  const jpeg = await renderUrlServer(url, ASPECT_PX[a.aspect]);
  const blob = await put(`merchant/${a.tenantId}/studio/${id}-ad.jpg`, jpeg, { access: "public", contentType: "image/jpeg", addRandomSuffix: true });
  await db.studioAsset.update({ where: { id }, data: { finalUrl: blob.url, finalPath: blob.pathname, status: "DONE", error: null } });
  if (a.finalUrl) await del(a.finalUrl).catch(() => undefined);
  return { url: blob.url, pathname: blob.pathname };
}

/**
 * Move one picture on, from whatever state it is in. Safe to call any number of times from the
 * webhook and the clock: Higgsfield is always asked for the real state, and each step claims
 * the row first.
 */
export async function advanceAsset(id: string, now = Date.now()): Promise<void> {
  const a = await db.studioAsset.findUnique({
    where: { id },
    select: { tenantId: true, status: true, requestId: true, rawPath: true, createdAt: true, updatedAt: true },
  });
  if (!a) return;

  if (a.status === "QUEUED") {
    // The start was cut before Higgsfield's answer was saved: nothing to follow.
    if (now - a.createdAt.getTime() > 10 * 60_000) await failAsset(id, "FAILED", "the start did not finish");
    return;
  }

  if (a.status === "RENDERING") {
    // A render that was cut: the picture is kept, so only the drawing is done again.
    if (now - a.updatedAt.getTime() < 5 * 60_000) return;
    if (!a.rawPath) {
      await db.studioAsset.updateMany({ where: { id, status: "RENDERING" }, data: { status: "RUNNING" } });
      return;
    }
    const took = await db.studioAsset.updateMany({ where: { id, status: "RENDERING", updatedAt: a.updatedAt }, data: { error: null } });
    if (took.count !== 1) return;
    await renderFinal(id).catch((e) => markDrawFailed(id, e));
    return;
  }

  if (a.status !== "RUNNING" || !a.requestId) return;
  const st = await generationStatus(a.requestId);
  if (st.state === "queued" || st.state === "in_progress") {
    if (now - a.createdAt.getTime() > GIVE_UP_MS) await failAsset(id, "FAILED", "Higgsfield did not finish in time");
    // Checked now: the clock moves on to the other pictures and comes back in a minute.
    else await db.studioAsset.updateMany({ where: { id, status: "RUNNING" }, data: { updatedAt: new Date(now) } });
    return;
  }
  if (st.state === "nsfw") return void (await failAsset(id, "BLOCKED", "blocked by content moderation"));
  if (st.state !== "completed" || !st.imageUrl) return void (await failAsset(id, "FAILED", st.error ?? `Higgsfield: ${st.state}`));

  const took = await db.studioAsset.updateMany({ where: { id, status: "RUNNING" }, data: { status: "RENDERING" } });
  if (took.count !== 1) return;
  let rawPath: string;
  try {
    rawPath = a.rawPath ?? (await keepRaw(a.tenantId, id, st.imageUrl));
  } catch (e) {
    // Try again on the next minute while Higgsfield still has the file.
    await db.studioAsset.update({ where: { id }, data: { status: "RUNNING", error: (e instanceof Error ? e.message : "download failed").slice(0, 300) } });
    return;
  }
  await db.studioAsset.update({ where: { id }, data: { rawPath } });
  await renderFinal(id).catch((e) => markDrawFailed(id, e));
}

/** The picture is made and kept, but the text could not be drawn: the shop keeps the picture and can change the text. */
async function markDrawFailed(id: string, e: unknown): Promise<void> {
  await db.studioAsset.update({ where: { id }, data: { status: "DONE", error: (e instanceof Error ? e.message : "the text could not be drawn").slice(0, 300) } });
}

/** The minute clock: pictures whose webhook did not come, cut renders, and starts that never finished. */
export async function pollStudio(now = Date.now()): Promise<{ checked: number }> {
  const due = await db.studioAsset.findMany({
    where: {
      OR: [
        { status: "RUNNING", updatedAt: { lt: new Date(now - 60_000) } },
        { status: "RENDERING", updatedAt: { lt: new Date(now - 5 * 60_000) } },
        { status: "QUEUED", createdAt: { lt: new Date(now - 10 * 60_000) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 6,
    select: { id: true },
  });
  for (const d of due) {
    await advanceAsset(d.id, now).catch((e) => console.error("[studio] advance failed:", e instanceof Error ? e.message : "unknown error"));
  }
  return { checked: due.length };
}
