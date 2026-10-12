// The director: one model call that turns a brand's facts (and what the owner asked for) into the
// storyboard JSON of a video ad. LITE uses Claude Haiku, PRO uses Claude Opus 5.5, both through
// kurd.gg. Whatever comes back goes through normalizeSpec; if it cannot be repaired the video is
// still made from a plain storyboard written from the facts, so a model hiccup never costs the
// owner a video.

import { kurdggConfigured, kurdggJson } from "@/lib/ai/kurdgg";
import { completeJson, type JsonCall } from "@/lib/ai/provider";
import type { AdBrief } from "./brief";
import type { VideoTier } from "./limits";
import { AD_ICONS, normalizeSpec, type AdScene, type AdSpec } from "./spec";

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
Scene types: hook (the brand appears; opens the video), value (one thing the shop stands for, with an icon), product (the product's photo; needs a photo index), offer (ONLY when the owner's request states an offer or occasion; use their words, never make one up), cta (invite the viewer to get in touch; closes the video).
Icons (value scenes): ${AD_ICONS.join(", ")}.
Styles: elegant (dark and premium), bold (loud, energetic, the brand's bright colour), clean (light, friendly, minimal).`;

const FLAVOR: Record<VideoTier, string> = {
  LITE: `Storyboard: a hook, then exactly three value scenes taken from the facts (what the shop stands for, its delivery, its product), then one product scene if photos are available, then a cta. Four to six scenes.`,
  PRO: `Storyboard: five to seven scenes, in the most persuasive order for THIS shop. Open with a hook that stops the scroll, build desire, show the product (use the photos available, one product scene per photo at most), give two or three reasons to trust the shop from the facts, add an offer scene only if the owner's request states one, and close with a cta. Choose the style that fits the brand. Vary the icons. Make every line sound like a person who loves this shop, not like an advertisement template.`,
};

const SCHEMA = `{
  "style": "elegant" | "bold" | "clean",
  "scenes": [
    { "type": "hook" | "value" | "product" | "offer" | "cta", "text": "1-5 words on screen", "sub": "optional small line, no prices", "voice": "one spoken Sorani sentence, no digits", "icon": "value scenes only", "photo": "product scenes only: index 0..photos_available-1" }
  ],
  "caption": "the post text: two or three short Sorani lines, then three to five hashtags in Kurdish letters"
}`;

export function directorSystem(tier: VideoTier): string {
  return `${CORE}\n\n${FLAVOR[tier]}\n\nReply with one JSON object only.`;
}

export function directorUser(brief: AdBrief, topic: string | null, problems?: string[]): string {
  const facts = {
    brand: { name: brief.name, tagline: brief.tagline, delivery_note: brief.deliveryNote, delivery: brief.deliveryLine },
    product: brief.product ? { name: brief.product.name, description: brief.product.description?.slice(0, 400) ?? null } : null,
    other_products: brief.catalog.map((p) => p.name).slice(0, 8),
    photos_available: brief.photos.length,
    owner_request: topic?.trim() || null,
  };
  const retry = problems?.length ? `\n\nYour previous storyboard was refused because: ${problems.join("; ")}. Fix exactly that.` : "";
  return `Facts:\n${JSON.stringify(facts, null, 2)}\n\nReply in this shape:\n${SCHEMA}${retry}`;
}

/** A storyboard made only from the facts, in plain Sorani that the voice always accepts. */
export function fallbackSpec(brief: AdBrief): AdSpec {
  const hasProduct = brief.photos.length > 0 && !!brief.product;
  const scenes: AdScene[] = [
    { type: "hook", text: brief.name, sub: brief.tagline, voice: "بەخێربێیت بۆ ئەم دووکانە جوانە، ئێمە هەموو کات لێرەین بۆ تۆ", icon: null, photo: null },
    { type: "value", text: "کوالێتی", sub: null, voice: "کوالێتی لە هەموو هەنگاوێکی کارەکانماندا دیارە", icon: "gem", photo: null },
    ...(brief.deliveryLine || brief.deliveryNote
      ? [{ type: "value" as const, text: "گەیاندن", sub: brief.deliveryNote, voice: "بەرهەمەکانت بە خێرایی و بە متمانەوە بۆ دەگەیەنین", icon: "truck" as const, photo: null }]
      : [{ type: "value" as const, text: "متمانە", sub: null, voice: "متمانەی تۆ گرنگترین شتە بۆ ئێمە", icon: "shield-check" as const, photo: null }]),
    ...(hasProduct ? [{ type: "product" as const, text: brief.product!.name, sub: null, voice: "ئەمە یەکێکە لە بەرهەمە جوانەکانمان، بە دڵت دەبێت", icon: null, photo: 0 }] : []),
    { type: "cta", text: "پەیوەندیمان پێوە بکە", sub: null, voice: "بۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە", icon: null, photo: null },
  ];
  return { style: "elegant", scenes, caption: `${brief.name}\nبۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە 🌷\n#کوردستان #دووکان` };
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

export async function writeAdSpec(input: { tier: VideoTier; brief: AdBrief; topic: string | null; call?: DirectorCall }): Promise<Written> {
  const { tier, brief, topic } = input;
  const call = input.call ?? defaultDirector(tier);
  const opts = { photos: brief.photos.length, hasTopic: !!topic?.trim(), maxScenes: MAX_SCENES[tier] };
  const timeout = tier === "PRO" ? 32_000 : 20_000;
  let problems: string[] | undefined;
  let model = "none";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await call({ system: directorSystem(tier), user: directorUser(brief, topic, problems), strength: "strong", thinking: false }, timeout);
      model = out.model;
      const n = normalizeSpec(out.data, opts);
      if (n.ok) return { spec: n.spec, model, fallback: false };
      problems = n.errors;
    } catch {
      break;
    }
  }
  return { spec: fallbackSpec(brief), model, fallback: true };
}
