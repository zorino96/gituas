// The director: one model call that turns a brand's facts (and what the owner asked for) into the
// storyboard JSON of a video ad. LITE uses Claude Haiku, PRO uses Claude Opus 5.5 (only the plan that
// includes Opus makes PRO videos), both through kurd.gg. Whatever comes back goes through
// normalizeSpec; if it cannot be repaired the video is
// still made from a plain storyboard written from the facts, so a model hiccup never costs the
// owner a video.
//
// The video's language (Sorani, Arabic or English) and kind (an ad, or a story for a content page) come in
// with the request: the prompt, the plain storyboard and the checks all follow them. A Sorani ad is
// written exactly as it always was. A story has no plain storyboard: invented content is never made
// from a template, so a story that cannot be written fails and the job's own retry takes over.

import { polishAdRaw } from "@/lib/ai/proofread";
import { completeJson, type JsonCall, type Meter } from "@/lib/ai/provider";
import type { AdBrief } from "./brief";
import { langFields, videoKindOf, videoLangOf, type VideoKind, type VideoLang } from "./lang";
import type { VideoTier } from "./limits";
import { AD_ICONS, LOOK_VOCAB, limitsFor, lookFromSeed, lookKey, normalizeSpec, styleOf, type AdLook, type AdScene, type AdSpec, type DailyBrief } from "./spec";

/** The most scenes a tier may use in an ad. */
export const MAX_SCENES: Record<VideoTier, number> = { LITE: 6, PRO: 7 };
/** The most scenes a tier may use in a story. */
export const STORY_MAX_SCENES: Record<VideoTier, number> = { LITE: 8, PRO: 10 };

/** The name of each language, for the model. */
const LANG_NAME: Record<VideoLang, string> = { ckb: "Sorani", ar: "Arabic", en: "English" };

/** What changes in an ad's prompt with the language: the language rule, and the letters the brand name and the hashtags are written in. */
const AD_LANG: Record<VideoLang, { rule: string; letters: string; hashtags: string }> = {
  ckb: {
    rule: "Language: every on-screen text and every spoken line is Central Kurdish (Sorani, Arabic script, letters ە ێ ۆ ڕ ڵ). Natural, warm, spoken; no English words, no Latin letters.",
    letters: "Kurdish letters",
    hashtags: "Kurdish letters",
  },
  ar: {
    rule: "Language: every on-screen text and every spoken line is simple Modern Standard Arabic in Arabic script. Natural, warm, spoken; no Latin letters, no Kurdish-only letters.",
    letters: "Arabic letters",
    hashtags: "Arabic letters",
  },
  en: {
    rule: "Language: every on-screen text and every spoken line is natural, warm, spoken English. Use Latin letters only: a brand or product name written in Arabic script in the facts is written in Latin letters (transliterated); no Arabic-script letters anywhere.",
    letters: "Latin letters",
    hashtags: "English",
  },
};

const adCore = (lang: VideoLang): string => `You are a creative director who makes short vertical video ads (Reels, TikTok, Shorts) for small shops in Iraqi Kurdistan. You write the storyboard as JSON; a separate engine draws it and a voice reads it aloud.

${AD_LANG[lang].rule}
Truth: use ONLY the facts you are given (brand name, tagline, delivery note, product name and description, the owner's request). Never invent prices, discounts, ingredients, results, guarantees, awards, numbers, stock or dates. Never write a price: the engine draws prices from the shop's own data.
Spoken lines ("voice"): one natural sentence of 6 to 14 words, NO digits, no emoji, no hashtags. All the spoken lines of the whole video together are at most 80 words (about 35 seconds): five or six scenes, not more. Say the brand name at most once in the whole video, and write it in ${AD_LANG[lang].letters}. Never read phone numbers (the engine shows them).
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

const adSchema = (lang: VideoLang): string => `{
  "look": { "layout": "...", "photo": "...", "icon": "...", "background": "...", "palette": "...", "motion": "...", "transition": "...", "shape": "..." },
  "scenes": [
    { "type": "hook" | "value" | "product" | "offer" | "footage" | "cta", "text": "1-5 words on screen", "sub": "optional small line, no prices", "voice": "one spoken ${LANG_NAME[lang]} sentence, no digits", "icon": "value scenes only", "photo": "product scenes only: index 0..photos_available-1", "clip": "footage scenes only: index 0..clips_available-1" }
  ],
  "caption": "the post text: two or three short ${LANG_NAME[lang]} lines, then three to five hashtags in ${AD_LANG[lang].hashtags}"
}`;

// ---- a story: the narrator of a content page, not a shop --------------------------------------------------

const STORY_LANG_RULE: Record<VideoLang, string> = {
  ckb: "Language: every on-screen text and every spoken line is Central Kurdish (Sorani, Arabic script, letters ە ێ ۆ ڕ ڵ). Natural, spoken, the way a good storyteller speaks; no English words, no Latin letters. Hashtags in Kurdish letters.",
  ar: "Language: every on-screen text and every spoken line is simple Modern Standard Arabic in Arabic script, natural and spoken, the way a good storyteller speaks. No Latin letters: write names in Arabic letters. Hashtags in Arabic.",
  en: "Language: every on-screen text and every spoken line is natural spoken English, the way a good storyteller speaks. Use Latin letters only: a name written in Arabic script in the facts is written in Latin letters (transliterated), and no Arabic-script letter appears anywhere. Hashtags in English.",
};

const storyCore = (lang: VideoLang): string => {
  const lim = limitsFor("story", lang);
  return `You are a storyteller who makes short vertical story videos (Reels, TikTok, Shorts) for a content channel. You write the storyboard as JSON; a separate engine draws it over a dark, moody look and a narrator reads it aloud.

${STORY_LANG_RULE[lang]}
The story: tell the story the channel owner asks for in story_request. If it names only a genre or an idea (a crime mystery, a ghost story, a legend), invent an original short story that fits it. If story_request is empty, choose a story that fits what the channel is about and differs from recent_hooks. One clear thread from start to finish: a beginning that hooks, a middle that raises the tension, a turn near the end and an ending that stays with the viewer.
Truth and safety: a story you invent is fiction. Never present a real, named, living person as guilty of anything or as the villain; use invented names. Never invent phone numbers, addresses, e-mail, prices, offers or links: the engine shows none.
Spoken lines ("voice"): the narrator's words for the beat: one or two natural sentences, up to ${lim.voiceWords} words, NO digits (write years and numbers as words), no emoji, no hashtags. All the spoken lines of the whole video together are at most ${lim.voiceTotalWords} words (about 60 to 70 seconds): count them, and if the story runs over, shorten the beats but keep the ending; a longer script is refused.
On-screen text ("text"): a short kicker of 1 to ${lim.textWords} words that names the beat (a place, a time, a question); it is required. "sub": an optional small line of up to ${lim.subWords} words. Digits are fine on screen (a year), never a price or a link.
Scene types: hook (opens the video: the text is the story's title or a question, the voice is the cold open that makes people stay), story (one beat of the story: the text is its kicker; it may sit over one of the pictures or clips available), footage (one of the owner's own clips plays behind the text; needs a clip index; use it only when a clip suits the story), cta (the closing invitation: ask the viewer to follow the channel and to say in the comments what they think happened; closes the video).
Backdrops: "photo" and "clip" on a story scene are optional indexes of the owner's own pictures and clips (see photos_available and clips_available); use one only when it fits the beat, otherwise null.
The look is dark and moody. Choose each part of the look from its list:
${Object.entries(LOOK_VOCAB).map(([k, v]) => `- ${k}: ${v.join(" | ")}`).join("\n")}
For a story choose a dark palette (midnight or brand-dark), calm motion, a quiet background (dust, glow or rings) and fading transitions (crossfade or iris); the text sits at the bottom or in the centre.`;
};

const STORY_FLAVOR: Record<VideoTier, string> = {
  LITE: `Storyboard: a hook, then three to six story beats, then a cta: five to eight scenes in all. Keep every beat to one or two short sentences and stay inside the word total.`,
  PRO: `Storyboard: a hook, then five to eight story beats (add one footage scene only if a clip suits the story), then a cta: seven to ten scenes in all. Make it vivid and cinematic: concrete details, a turn near the end, an ending that lingers. Vary the kickers. Stay inside the word total.`,
};

const storySchema = (lang: VideoLang): string => `{
  "look": { "layout": "...", "photo": "...", "icon": "...", "background": "...", "palette": "...", "motion": "...", "transition": "...", "shape": "..." },
  "scenes": [
    { "type": "hook" | "story" | "footage" | "cta", "text": "kicker, 1-5 words on screen", "sub": "optional small line", "voice": "the narrator's words for this beat in ${LANG_NAME[lang]}, no digits", "photo": "story scenes only, optional: index 0..photos_available-1 or null", "clip": "footage scenes (required) and story scenes (optional): index 0..clips_available-1 or null" }
  ],
  "caption": "the post text in ${LANG_NAME[lang]}: a teaser that makes people watch, then three to five hashtags (at most ${limitsFor("story", lang).caption} characters)"
}`;

/** The director's system prompt. A Sorani ad (the defaults) is the text this module always sent. */
export function directorSystem(tier: VideoTier, lang: VideoLang = "ckb", kind: VideoKind = "ad"): string {
  if (kind === "story") return `${storyCore(lang)}\n\n${STORY_FLAVOR[tier]}\n\nReply with one JSON object only.`;
  return `${adCore(lang)}\n\n${FLAVOR[tier]}\n\nReply with one JSON object only.`;
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
  /** The language of the video; absent = Sorani. */
  lang?: VideoLang;
  /** What the video is; absent = an ad. */
  kind?: VideoKind;
  /** A story: what the channel is about, in the owner's words. */
  channel?: { about: string | null };
}

export function directorUser(brief: AdBrief, topic: string | null, problems?: string[], ctx: DirectorContext = {}): string {
  const lang = videoLangOf(ctx.lang);
  const retry = problems?.length ? `\n\nYour previous storyboard was refused because: ${problems.join("; ")}. Fix exactly that.` : "";
  if (videoKindOf(ctx.kind) === "story") return storyUser(brief, topic, ctx, lang, retry);
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
    ...(lang !== "ckb" ? { output_language: LANG_NAME[lang] } : {}),
  };
  const notes: string[] = [];
  if (lang !== "ckb") {
    notes.push(
      `The video is in ${LANG_NAME[lang]}: write every on-screen text, spoken line and the caption in ${LANG_NAME[lang]}, even when the facts or the owner's request are in another language (translate them, keep the meaning). ${lang === "en" ? "Write the brand and product names in Latin letters (transliterate names written in Arabic script)." : "Write the brand and product names in Arabic letters."}`,
    );
  }
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
  return `Facts:\n${JSON.stringify(facts, null, 2)}${notes.length ? `\n\n${notes.join("\n")}` : ""}\n\nReply in this shape:\n${adSchema(lang)}${retry}`;
}

/** A story's user message: the channel and the request, and nothing about a shop (no price, delivery, phone, catalog or daily plan). */
function storyUser(brief: AdBrief, topic: string | null, ctx: DirectorContext, lang: VideoLang, retry: string): string {
  const facts = {
    channel: { name: brief.name, about: ctx.channel?.about ?? null },
    story_request: topic?.trim() || null,
    language: LANG_NAME[lang],
    photos_available: brief.photos.length,
    reference_picture_indices: brief.refIndices,
    clips_available: brief.clips.length,
    recently_used_looks: (ctx.avoidLooks ?? []).map(lookKey),
    recent_hooks: ctx.recentHooks ?? [],
  };
  const notes: string[] = [];
  if (!facts.story_request) notes.push("story_request is empty: choose the next story yourself, one that fits the channel and is clearly different from recent_hooks.");
  if (lang === "en") notes.push("The story is told in English. Write the channel name and every name in Latin letters.");
  if (ctx.refPictures) {
    notes.push(`${ctx.refPictures} picture(s) are attached: the owner's own reference material for the channel. Take their mood, colours and composition as the guide for the look and the images; never copy any text, logo or face from them.`);
  }
  if (facts.recently_used_looks.length) notes.push("Pick a look that clearly differs from recently_used_looks, and a hook that differs from recent_hooks.");
  if (brief.clips.length) notes.push("When a clips_available clip suits the story, use one footage scene; do not overuse it.");
  return `Facts:\n${JSON.stringify(facts, null, 2)}${notes.length ? `\n\n${notes.join("\n")}` : ""}\n\nReply in this shape:\n${storySchema(lang)}${retry}`;
}

/** An ad's plain storyboard: the words of each language. Sorani is the text this module always used. */
interface FallbackCopy {
  hook: string;
  quality: { text: string; voice: string };
  delivery: { text: string; voice: string };
  trust: { text: string; voice: string };
  product: string;
  cta: { text: string; voice: string };
  /** The caption after the brand's name. */
  caption: string;
  /** When the brand's name cannot be shown in this language (English, name in Arabic script). */
  welcome: string;
  productFallback: string;
}

const FALLBACK: Record<VideoLang, FallbackCopy> = {
  ckb: {
    hook: "بەخێربێیت بۆ ئەم دووکانە جوانە، ئێمە هەموو کات لێرەین بۆ تۆ",
    quality: { text: "کوالێتی", voice: "کوالێتی لە هەموو هەنگاوێکی کارەکانماندا دیارە" },
    delivery: { text: "گەیاندن", voice: "بەرهەمەکانت بە خێرایی و بە متمانەوە بۆ دەگەیەنین" },
    trust: { text: "متمانە", voice: "متمانەی تۆ گرنگترین شتە بۆ ئێمە" },
    product: "ئەمە یەکێکە لە بەرهەمە جوانەکانمان، بە دڵت دەبێت",
    cta: { text: "پەیوەندیمان پێوە بکە", voice: "بۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە" },
    caption: "بۆ داواکاری و زانیاری زیاتر پەیوەندیمان پێوە بکە 🌷\n#کوردستان #دووکان",
    welcome: "",
    productFallback: "",
  },
  ar: {
    hook: "أهلاً بك في متجرنا الجميل، نحن هنا دائماً من أجلك",
    quality: { text: "الجودة", voice: "الجودة واضحة في كل خطوة من عملنا" },
    delivery: { text: "التوصيل", voice: "نوصّل طلباتك بسرعة وبكل ثقة" },
    trust: { text: "الثقة", voice: "ثقتك هي أهم شيء بالنسبة لنا" },
    product: "هذا واحد من منتجاتنا الجميلة، وسيعجبك",
    cta: { text: "تواصل معنا", voice: "للطلب ولمعرفة المزيد تواصل معنا" },
    caption: "للطلب ولمعرفة المزيد تواصل معنا 🌷\n#كردستان #متجر",
    welcome: "",
    productFallback: "",
  },
  en: {
    hook: "Welcome to our lovely shop, we are always here for you",
    quality: { text: "Quality", voice: "Quality shows in every step of what we do" },
    delivery: { text: "Delivery", voice: "We bring your order to you quickly and with care" },
    trust: { text: "Trust", voice: "Your trust matters most to us" },
    product: "This is one of our lovely products, and we think you will love it",
    cta: { text: "Get in touch", voice: "To order or to ask anything, just get in touch" },
    caption: "To order or to ask anything, just get in touch 🌷\n#shop #kurdistan",
    welcome: "Welcome",
    productFallback: "Our product",
  },
};

const arabicScript = (s: string) => /\p{Script=Arabic}/u.test(s);

/** A storyboard made only from the facts, in plain words that the voice always accepts. */
export function fallbackSpec(brief: AdBrief, seed: string = brief.name, avoid: AdLook[] = [], plan?: DailyBrief | null, lang: VideoLang = "ckb"): AdSpec {
  const c = FALLBACK[lang];
  // An English video shows no Arabic-script letters: a brand or product name written in them is replaced by a plain word.
  const shown = (s: string | null, instead: string | null): string | null => (s && lang === "en" && arabicScript(s) ? instead : s);
  const hasProduct = brief.photos.length > 0 && !!brief.product;
  const scenes: AdScene[] = [
    { type: "hook", text: shown(brief.name, c.welcome) ?? "", sub: shown(brief.tagline, null), voice: c.hook, icon: null, photo: null, clip: null },
    { type: "value", text: c.quality.text, sub: null, voice: c.quality.voice, icon: "gem", photo: null, clip: null },
    ...(brief.deliveryLine || brief.deliveryNote
      ? [{ type: "value" as const, text: c.delivery.text, sub: shown(brief.deliveryNote, null), voice: c.delivery.voice, icon: "truck" as const, photo: null, clip: null }]
      : [{ type: "value" as const, text: c.trust.text, sub: null, voice: c.trust.voice, icon: "shield-check" as const, photo: null, clip: null }]),
    ...(hasProduct ? [{ type: "product" as const, text: shown(brief.product!.name, c.productFallback) ?? "", sub: null, voice: c.product, icon: null, photo: 0, clip: null }] : []),
    { type: "cta", text: c.cta.text, sub: null, voice: c.cta.voice, icon: null, photo: null, clip: null },
  ];
  const look = lookFromSeed(seed, avoid);
  const name = shown(brief.name, null);
  return {
    style: styleOf(look),
    look,
    plan: plan ? { objective: plan.objective, why: plan.why, format: plan.format, priceMode: plan.priceMode, cta: plan.cta } : undefined,
    scenes, caption: `${name === null ? "" : `${name}\n`}${c.caption}`,
    ...langFields(lang, "ad"),
  };
}

export type DirectorCall = (call: JsonCall, timeoutMs: number) => Promise<{ data: unknown; model: string }>;

/**
 * kurd.gg with the tier's model (Opus for PRO, Haiku for LITE). The store's allowance decides whether
 * Opus is really used: when the Opus part of its month is gone the call is made with Haiku, and when
 * the whole allowance is gone it is refused and the plain storyboard is used.
 */
export function defaultDirector(tier: VideoTier, meter?: Meter): DirectorCall {
  // The owner's order for video scripts: DeepSeek V4.1 Flash first, the gateway's Claude, then Haiku (see videoOrder in the provider).
  return (call, timeoutMs) => completeJson({ ...call, tier: tier === "PRO" ? "opus" : "haiku", meter: call.meter ?? meter, budgetMs: timeoutMs, prefer: "video" });
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
  /** The store whose allowance pays for the call. */
  meter?: Meter;
  /**
   * When the function that runs this must be done (ms since the epoch). A story's calls and its Sorani proofreader are held
   * to what is left of it, so the script is saved before the function is cut off; without one only STORY_BUDGET_MS applies.
   */
  deadline?: number;
}

/** One director call, per tier: an ad's answers come in 15 to 25 seconds, a story is three times as long. */
const AD_TIMEOUT: Record<VideoTier, number> = { LITE: 20_000, PRO: 40_000 };
const AD_MAX_TOKENS: Record<VideoTier, number> = { LITE: 2400, PRO: 3200 };
// A story's call is kept inside what one run of the video job may use (the cron routes give a PREPARE a budget of
// about 55 of the 60 seconds; a PRO job is only started with 50 left): one call may take 50 s on PRO, and the whole
// writer (the calls and the Sorani proofreader) is held to STORY_BUDGET_MS and to the job's real deadline, less the
// time to save the script. A second try is made only if time is left.
const STORY_TIMEOUT: Record<VideoTier, number> = { LITE: 30_000, PRO: 50_000 };
const STORY_MAX_TOKENS: Record<VideoTier, number> = { LITE: 3600, PRO: 4800 };
const STORY_BUDGET_MS = 52_000;
const STORY_RETRY_MIN_MS = 12_000;
/** Kept back from the deadline for writing the script to the database. */
const STORY_SAVE_MS = 3_000;

export async function writeAdSpec(input: WriteInput): Promise<Written> {
  const { tier, brief, topic } = input;
  const lang = videoLangOf(input.lang);
  const kind = videoKindOf(input.kind);
  const story = kind === "story";
  const call = input.call ?? defaultDirector(tier);
  const seed = input.seed ?? brief.name;
  // What the texts may mention: the owner's words and the shop's own names, descriptions and price lines.
  // A story may mention only the owner's words, the channel's name and what it is about.
  const allowed = (
    story
      ? [topic, brief.name, input.channel?.about, brief.handle]
      : [
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
  )
    .filter(Boolean)
    .join(" ");
  const opts = { photos: brief.photos.length, clips: brief.clips.length, hasTopic: !!topic?.trim(), maxScenes: story ? STORY_MAX_SCENES[tier] : MAX_SCENES[tier], seed, avoid: input.avoidLooks ?? [], allowed, lang, kind };
  const timeout = story ? STORY_TIMEOUT[tier] : AD_TIMEOUT[tier];
  const ctx: DirectorContext = { plan: input.plan, avoidLooks: input.avoidLooks, recentHooks: input.recentHooks, refPictures: input.images?.length ?? 0, lang, kind, channel: input.channel };
  const started = Date.now();
  // The time a story's writer has left: the budget of the writer, and the job's real deadline (the pictures and the brief
  // were fetched before this started) less the time to save.
  const left = () => Math.min(STORY_BUDGET_MS - (Date.now() - started), input.deadline === undefined ? Infinity : input.deadline - Date.now() - STORY_SAVE_MS);
  let problems: string[] | undefined;
  let model = "none";
  let withPictures = !!input.images?.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (story && attempt > 0 && left() < STORY_RETRY_MIN_MS) break;
    try {
      const out = await call(
        {
          system: directorSystem(tier, lang, kind),
          user: directorUser(brief, topic, problems, ctx),
          strength: "strong",
          maxTokens: story ? STORY_MAX_TOKENS[tier] : AD_MAX_TOKENS[tier],
          meter: input.meter,
          ...(withPictures ? { images: input.images } : {}),
        },
        story ? Math.max(5_000, Math.min(timeout, left())) : timeout,
      );
      model = out.model;
      // The spoken lines and the caption are corrected by the Sorani proofreader first; if the corrected text breaks one of the
      // spec's own rules (a number, a claim, the word limits) the model's own text is used.
      // (The proofreader answers in 13 to 15 s, which an asynchronous video job has: it is waited for up to 18 s.)
      // Only Sorani goes through it: it takes any Arabic-script text for Kurdish and would "correct" Arabic into Sorani.
      // A story gives it only the time that is left, and not at all when that is less than it takes to answer.
      const polishMs = lang !== "ckb" ? 0 : story ? Math.min(18_000, left() - 3_000) : 18_000;
      const polished = polishMs >= (story ? 14_000 : 5_000) ? await polishAdRaw(out.data, { timeoutMs: polishMs }) : out.data;
      let n = normalizeSpec(polished, opts);
      if (!n.ok && polished !== out.data) n = normalizeSpec(out.data, opts);
      if (n.ok) {
        // The plan the owner sees is the strategist's: the director cannot rewrite why a video was made.
        const plan = input.plan ? { objective: input.plan.objective, why: input.plan.why, format: input.plan.format, priceMode: input.plan.priceMode, cta: input.plan.cta } : n.spec.plan;
        return { spec: { ...n.spec, plan }, model, fallback: false };
      }
      problems = n.errors;
    } catch {
      // No model could read the pictures (the stand-by provider cannot see): one more go from the words alone, so a
      // video with reference pictures is not turned into the plain template just because the pictures could not be read.
      if (withPictures) {
        withPictures = false;
        ctx.refPictures = 0;
        attempt--;
        continue;
      }
      break;
    }
  }
  // A story is invented content: it is never made from a template. The job's own retry (and refund) takes over.
  if (story) throw new Error(`the story could not be written${problems?.length ? `: ${problems.join("; ")}` : ""}`.slice(0, 280));
  return { spec: fallbackSpec(brief, seed, input.avoidLooks ?? [], input.plan, lang), model, fallback: true };
}
