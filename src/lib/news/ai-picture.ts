// A made-up, symbolic background for a story that has no photo: Cloudflare Workers AI (FLUX schnell, a free daily
// allowance). The story's headline is first turned into a short English scene (no people, no text), then drawn.
// The card says "illustration (AI)": it is never passed off as a photo of the event. Never throws.
//
//   CF_ACCOUNT_ID, CF_AI_TOKEN   set in Vercel; the feature is off without them

import { put } from "@vercel/blob";
import sharp from "sharp";

import { completeJson } from "@/lib/ai/provider";
import { claimSlot, refundSlot, type SlotMetric } from "@/lib/ai/slots";

/** The marker in a stored pathname that tells the card to say "illustration (AI)". */
export const AI_IMAGE_MARK = "/ai-img-";
export const isAiImage = (pathname: string | null | undefined): boolean => !!pathname && pathname.includes(AI_IMAGE_MARK);

export const NEWS_PICTURE_SLOTS: SlotMetric = { month: "news_ai_picture", day: "news_ai_picture_day" };
export const NEWS_PICTURE_CAPS = { month: 600, day: 40 };

const MODEL = "@cf/black-forest-labs/flux-1-schnell";

export const aiPictureEnabled = (): boolean => !!process.env.CF_ACCOUNT_ID?.trim() && !!process.env.CF_AI_TOKEN?.trim();

const SCENE_SYSTEM = `You write the background picture idea for a news card. You get a news story (any language). Answer with JSON {"scene": "..."}: ONE short English sentence (at most 25 words) describing a calm, symbolic, generic scene that suits the topic: a city skyline, an empty courtroom, oil pipelines at dusk, a stack of documents, a stadium at night, a hospital corridor. Never a real person, never a face or a crowd of identifiable people, never a flag of a named country, never text, signs or logos, never violence or injury, never an invented event.`;

export async function aiPictureForStory(tenantId: string, story: { title: string; snippet: string }, budgetMs = 40_000): Promise<string | null> {
  if (!aiPictureEnabled() || budgetMs < 15_000) return null;
  const started = Date.now();
  const slot = await claimSlot(tenantId, NEWS_PICTURE_SLOTS, NEWS_PICTURE_CAPS).catch(() => null);
  if (!slot || !slot.ok) return null;
  let sent = false;
  try {
    const { data } = await completeJson<string>(
      { system: SCENE_SYSTEM, user: `${story.title}${story.snippet ? ` — ${story.snippet.slice(0, 300)}` : ""}`, strength: "fast", thinking: false, budgetMs: Math.min(15_000, budgetMs - 10_000) },
      (d) => {
        const s = (d as { scene?: unknown } | null)?.scene;
        return typeof s === "string" && s.trim().length > 5 && s.length < 400 ? s.trim() : null;
      },
    );
    const prompt = `${data}. Editorial illustration, cinematic lighting, muted colours, wide composition, no text, no letters, no logos, no people.`;
    const left = budgetMs - (Date.now() - started) - 5_000;
    if (left < 8_000) throw new Error("no time");
    sent = true;
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID!.trim()}/ai/run/${MODEL}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CF_AI_TOKEN!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, steps: 6 }),
      signal: AbortSignal.timeout(left),
    });
    if (!res.ok) throw new Error(`cf ${res.status}`);
    const body = (await res.json()) as { result?: { image?: string } };
    const b64 = body.result?.image;
    if (!b64) throw new Error("no image");
    const jpg = await sharp(Buffer.from(b64, "base64")).resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    const blob = await put(`merchant/${tenantId}${AI_IMAGE_MARK}${Date.now()}.jpg`, jpg, { access: "public", contentType: "image/jpeg", addRandomSuffix: true, allowOverwrite: false });
    return blob.pathname;
  } catch (e) {
    // The allowance is free and a failed call produced nothing, so the slot is given back.
    await refundSlot(tenantId, NEWS_PICTURE_SLOTS, slot).catch(() => undefined);
    console.error("[cards] ai picture failed:", sent ? "after send" : "before send", e instanceof Error ? e.message.slice(0, 80) : "unknown");
    return null;
  }
}
