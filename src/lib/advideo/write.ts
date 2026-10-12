// The director: one model call that turns a brand's facts (and what the owner asked for) into the
// storyboard JSON of a video ad. LITE uses Claude Haiku, PRO uses Claude Opus 5.5, both through
// kurd.gg. Whatever comes back goes through normalizeSpec; if it cannot be repaired the video is
// still made from a plain storyboard written from the facts, so a model hiccup never costs the
// owner a video.

import { kurdggConfigured, kurdggJson } from "@/lib/ai/kurdgg";
import { completeJson, type JsonCall } from "@/lib/ai/provider";
import type { AdBrief } from "./brief";
import type { VideoTier } from "./limits";
import { AD_ICONS, LOOK_VOCAB, lookFromSeed, lookKey, normalizeSpec, styleOf, type AdLook, type AdScene, type AdSpec, type DailyBrief } from "./spec";

/** Claude Opus 5.5 as kurd.gg names it (listed by GET /v1/models); KURDGG_MODEL_VIDEO_PRO overrides it. */
export const DEFAULT_PRO_MODEL = "cc/claude-opus-5-5";

export function modelFor(tier: VideoTier): string | undefined {
  if (tier === "PRO") return process.env.KURDGG_MODEL_VIDEO_PRO?.trim() || DEFAULT_PRO_MODEL;
  return process.env.KURDGG_MODEL_VIDEO_LITE?.trim() || process.env.KURDGG_MODEL?.trim() || undefined;
}

/** The most scenes a tier may use. */
export const MAX_SCENES: Record<VideoTier, number> = { LITE: 6, PRO: 7 };

const CORE = `You are a creative director who makes short vertical video ads (Reels, TikTok, Shorts) for small shops in Iraqi Kurdistan. You write the storyboard as JSON; a separate engine draws it and a voice reads it aloud.

Language: every on-screen text and every spoken line is Central Kurdish (Sorani, Arabic script, letters ە ێ ۆ ڕ ڵ). Natural, warm, spoken; no English words, no Latin letters.
Truth: use ONLY the facts you are given (brand name, tagline, delivery note, product name and description, the owner's request). Never invent prices, discounts, ingredients, results, guarantees, awards, numbers, stock or dates. Never write a price: the engine draws prices from the shop's own data.
Spoken lines ("voice"): one natural sentence of 6 to 14 words, NO digits, no emoji, no hashtags. Say the brand name at most once in the whole video, and write it in Kurdish letters. Never read phone numbers (the engine shows them).
On-screen text ("text"): 1 to 5 words. "sub": an optional small line of up to 8 words, no prices and no numbers.
Scene types: hook (the brand appears; opens the video), value (one thing the shop stands for, with an icon), product (a photo; needs a photo index: the product's own photos come first, then the owner's reference pictures), footage (one of the owner's own short clips plays behind the text; needs a clip index), offer (ONLY when the owner's request states an offer or occasion; use their words, never make one up), cta (invite the viewer to get in touch; closes the video).
Icons (value scenes): ${AD_ICONS.join(", ")}.
Every video gets its OWN look, chosen for this brand, this product and today's plan, and it must not be the look of the recent videos. Choose each part of the look from its list:
${Object.entries(LOOK_VOCAB).map(([k, v]) => `- ${k}: ${v.join(" | ")}`).join("\n")}
Match the look to the brand and the mood in the plan: a children's shop is not a perfume shop; an occasion needs warmth; a delivery promise is plain and clear.`;

const FLAVOR: Record<VideoTier, string> = {
  LITE: `Storyboard: a hook, then exactly three value scenes taken from the facts (what the shop stands for, its delivery, its product), then one product scene if photos are available, then a cta. Four to six scenes.`,
  PRO: `Storyboard: five to seven scenes, in the most persuasive order for THIS shop. Open with a hook that stops the scroll, build desire, show the product (use the photos available, one product scene per photo at most), give two or three reasons to trust the shop from the facts, add an offer scene only if the owner's request states one, and close with a cta. Choose the style that fits the brand. Vary the icons. Make every line sound like a person who loves this shop, not like an advertisement template.`,
};

const SCHEMA = `{
  "look": { "layout": "...", "photo": "...", "icon": "...", "background": "...", "palette": "...", "motion": "...", "transition": "...", "shape": "..." },
  "scenes": [
    { "type": "hook" | "value" | "product" | "offer" | "footage" | "cta", "text": "1-5 words on screen", "sub": "optional small line, no prices", "voice": "one spoken Sorani sentence, no digits", "icon": "value scenes only", "photo": "product scenes only: index 0..photos_available-1", "clip": "footage scenes only: index 0..clips_available-1" }
  ],
  "caption": "the post text: two or three short Sorani lines, then three to five hashtags in Kurdish letters"
}`;

export function directorSystem(tier: VideoTier): string {
  return `${CORE}\n\n${FLAVOR[tier]}\n\nReply with one JSON object only.`;
}

export interface DirectorContext {
  /** Today's plan for the store: what the video is for and why. */
  plan?: DailyBrief | null;
  /** The looks of the last videos: this one must be clearly different. */
  avoidLooks?: AdLook[];
  /** The hooks of the last videos, so a line is not said again. */
  recentHooks?: string[];
  /** How many pictures are attached: the owner's reference material. */
  refPictures?: number;
}

export function directorUser(brief: AdBrief, topic: string | null, problems?: string[], ctx: DirectorContext = {}): string {
  const facts = {
    brand: { name: brief.name, tagline: brief.tagline, delivery_note: brief.deliveryNote, delivery: brief.deliveryLine },
    product: brief.product ? { name: brief.product.name, description: brief.product.description?.slice(0, 400) ?? null } : null,
    other_products: brief.catalog.map((p) => p.name).slice(0, 8),
    photos_available: brief.photos.length,
    // Which photo numbers are the owner's own reference pictures (the others are the product's or the shop's).
    reference_picture_indices: brief.refIndices,
    clips_available: brief.clips.length,
    owner_request: topic?.trim() || null,
    todays_plan: ctx.plan
      ? {
          objective: ctx.plan.objective,
          format: ctx.plan.format,
          price_mode: ctx.plan.priceMode,
          call_to_action: ctx.plan.cta,
          why_today: ctx.plan.why,
          urgent: ctx.plan.urgent,
          avoid: ctx.plan.avoid,
          look_mood: ctx.plan.lookMood,
        }
      : null,
    recently_used_looks: (ctx.avoidLooks ?? []).map(lookKey),
    recent_hooks: ctx.recentHooks ?? [],
  };
  const notes: string[] = [];
  if (ctx.refPictures) {
    notes.push(`${ctx.refPictures} picture(s) are attached: the owner's own reference material for this brand and product. Take their mood, colours and composition as the guide for the look and the copy; never copy any text, logo or face from them.`);
  }
  if (ctx.plan) {
    notes.push(
      `Follow today's plan: the video's purpose is "${ctx.plan.objective}" (${ctx.plan.format}). ${ctx.plan.priceMode === "engagement" ? "Do not speak or show a price: buyers should ask." : "Showing the price is fine; the engine draws it from the shop's data."} The call to action is "${ctx.plan.cta}": ${ctx.plan.cta === "whatsapp" ? "invite them to message on WhatsApp" : ctx.plan.cta === "dm" ? "invite them to send a direct message" : "invite them to write in the comments"}.`,
    );
  }
  if (facts.recently_used_looks.length) notes.push("Pick a look that clearly differs from recently_used_looks, and a hook that differs from recent_hooks.");
  if (brief.clips.length) notes.push("When a clips_available clip suits the story, use one footage scene so the real shop appears; do not overuse it.");
  const retry = problems?.length ? `\n\nYour previous storyboard was refused because: ${problems.join("; ")}. Fix exactly that.` : "";
  return `Facts:\n${JSON.stringify(facts, null, 2)}${notes.length ? `\n\n${notes.join("\n")}` : ""}\n\nReply in this shape:\n${SCHEMA}${retry}`;
}

/** A storyboard made only from the facts, in plain Sorani that the voice always accepts. */
export function fallbackSpec(brief: AdBrief, seed: string = brief.name, avoid: AdLook[] = [], plan?: DailyBrief | null): AdSpec {
  const hasProduct = brief.photos.length > 0 && !!brief.product;
  const scenes: AdScene[] = [
    { type: "hook", text: brief.name, sub: brief.tagline, voice: "بەخێربێیت بۆ ئەم دووکانە جوانە، ئێمە هەموو کات لێرەین بۆ تۆ", icon: null, photo: null, clip: null },
    { type: "value", text: "کوالێتی", sub: null, voice: "کوالێتی لە هەموو هەنگاوێکی کارەکانماندا دیارە", icon: "gem", photo: null, clip: null },
    ...(brief.deliveryLine || brief.deliveryNote
      ? [{ type: "value" as const, text: "گەیاندن", sub: brief.deliveryNote, voice: "بەرهەمەکانت بە خێرایی و بە متمانەوە بۆ دەگەیەنین", icon: "truck" as const, photo: null, clip: null }]
      : [{ type: "value" as const, text: "متمانە", sub: null, voice: "متمانەی تۆ گرنگترین شتە بۆ ئێمە", icon: "shield-check" as const, photo: null, clip: null }]),
    ...(hasProduct ? [{ type: "product" as const, text: brief.product!.name, sub: null, voice: "ئەمە یەکێکە لە بەرهەمە جوانەکانمان، بە دڵت دەبێت", icon: null, photo: 0, clip: null }] : []),
    { type: "cta", text: "پەیوەندیمان پێوە بکە", sub: null, voice: "بۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە", icon: null, photo: null, clip: null },
  ];
  const look = lookFromSeed(seed, avoid);
  return {
    style: styleOf(look),
    look,
    plan: plan ? { objective: plan.objective, why: plan.why, format: plan.format, priceMode: plan.priceMode, cta: plan.cta } : undefined,
    scenes, caption: `${brief.name}\nبۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە 🌷\n#کوردستان #دووکان`,
  };
}

export type DirectorCall = (call: JsonCall, timeoutMs: number) => Promise<{ data: unknown; model: string }>;

/** kurd.gg with the tier's model; a PRO call that fails is tried once on the LITE model, then on the general chain. */
export function defaultDirector(tier: VideoTier): DirectorCall {
  return async (call, timeoutMs) => {
    const started = Date.now();
    const left = () => Math.max(8_000, timeoutMs - (Date.now() - started));
    if (kurdggConfigured()) {
      const models = [modelFor(tier), ...(tier === "PRO" ? [modelFor("LITE")] : [])].filter((m, i, a): m is string => !!m && a.indexOf(m) === i);
      for (const model of models) {
        try {
          return await kurdggJson({ ...call, model }, model === models[0] ? timeoutMs : left());
        } catch {
          /* the next model, then the general chain */
        }
      }
    }
    return completeJson({ ...call, budgetMs: left() });
  };
}

export interface Written {
  spec: AdSpec;
  model: string;
  /** True when the model could not give a usable storyboard and the plain one was used. */
  fallback: boolean;
}

export interface WriteInput extends DirectorContext {
  tier: VideoTier;
  brief: AdBrief;
  topic: string | null;
  call?: DirectorCall;
  /** The brand and the day: the look falls back to a choice made from it. */
  seed?: string;
  /** The reference pictures, already small data URLs. */
  images?: string[];
}

export async function writeAdSpec(input: WriteInput): Promise<Written> {
  const { tier, brief, topic } = input;
  const call = input.call ?? defaultDirector(tier);
  const seed = input.seed ?? brief.name;
  // What the texts may mention: the owner's words and the shop's own names, descriptions and price lines.
  const allowed = [
    topic,
    brief.name,
    brief.tagline,
    brief.deliveryNote,
    brief.deliveryLine,
    brief.phone,
    brief.handle,
    brief.product?.name,
    brief.product?.description,
    brief.product?.priceLine,
    ...brief.catalog.flatMap((p) => [p.name, p.priceLine]),
  ]
    .filter(Boolean)
    .join(" ");
  const opts = { photos: brief.photos.length, clips: brief.clips.length, hasTopic: !!topic?.trim(), maxScenes: MAX_SCENES[tier], seed, avoid: input.avoidLooks ?? [], allowed };
  const timeout = tier === "PRO" ? 32_000 : 20_000;
  const ctx: DirectorContext = { plan: input.plan, avoidLooks: input.avoidLooks, recentHooks: input.recentHooks, refPictures: input.images?.length ?? 0 };
  let problems: string[] | undefined;
  let model = "none";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await call(
        { system: directorSystem(tier), user: directorUser(brief, topic, problems, ctx), strength: "strong", thinking: false, ...(input.images?.length ? { images: input.images } : {}) },
        timeout,
      );
      model = out.model;
      const n = normalizeSpec(out.data, opts);
      if (n.ok) {
        // The plan the owner sees is the strategist's: the director cannot rewrite why a video was made.
        const plan = input.plan ? { objective: input.plan.objective, why: input.plan.why, format: input.plan.format, priceMode: input.plan.priceMode, cta: input.plan.cta } : n.spec.plan;
        return { spec: { ...n.spec, plan }, model, fallback: false };
      }
      problems = n.errors;
    } catch {
      break;
    }
  }
  return { spec: fallbackSpec(brief, seed, input.avoidLooks ?? [], input.plan), model, fallback: true };
}
