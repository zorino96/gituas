// The daily plan: once a day the strategist (Claude Haiku, or Opus 5.5 for a PRO store) reads the
// shop's own numbers, the calendar and the owner's notes, and decides what kind of video matters
// today and why. The plan is kept for the day (so a manual video and the daily one agree), shown to
// the owner in plain Sorani, and the director writes the video from it.
//
// What it is NOT: a market feed. No source gives live Iraqi demand or competitor prices, so the
// prompt forbids claiming any, and the owner's notes are the way to tell it what the market is doing.

import { createHmac } from "node:crypto";
import { head, put } from "@/lib/storage";

import { OCCASION_KU } from "./calendar";
import type { VideoTier } from "./limits";
import { gatherSignals, signalsText, type Signals } from "./signals";
import { OBJECTIVES, type DailyBrief, type Objective } from "./spec";
import type { Meter } from "@/lib/ai/provider";
import { defaultDirector, type DirectorCall } from "./write";

const NOTES_MAX = 800;

function planPath(tenantId: string, storeId: string, name: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  const key = createHmac("sha256", secret).update(`advideo-plan:${tenantId}:${storeId}:${name}`).digest("hex").slice(0, 32);
  return `merchant/${tenantId}/advideo-plan/${key}.json`;
}

/** The saved JSON, or null. The version in the address keeps the CDN from answering with a file that was just replaced. */
async function readJson<T>(tenantId: string, storeId: string, name: string): Promise<T | null> {
  try {
    const meta = await head(planPath(tenantId, storeId, name));
    const res = await fetch(`${meta.url}?v=${new Date(meta.uploadedAt).getTime()}`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(tenantId: string, storeId: string, name: string, value: unknown): Promise<void> {
  await put(planPath(tenantId, storeId, name), JSON.stringify(value), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

// ---- the owner's notes about the market ------------------------------------------------------------

export async function loadMarketNotes(tenantId: string, storeId: string): Promise<string> {
  const v = await readJson<{ text?: unknown }>(tenantId, storeId, "notes");
  return typeof v?.text === "string" ? v.text.slice(0, NOTES_MAX) : "";
}

export async function saveMarketNotes(tenantId: string, storeId: string, text: string): Promise<void> {
  await writeJson(tenantId, storeId, "notes", { text: Array.from(text.trim()).slice(0, NOTES_MAX).join(""), at: new Date().toISOString() });
}

// ---- the plan --------------------------------------------------------------------------------------

/** The Baghdad date, YYYY-MM-DD. */
export function baghdadDate(now: number): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

const PLAN_SYSTEM = `You are the marketing strategist of a small shop in Iraqi Kurdistan that sells through Facebook and Instagram, closes in DMs or WhatsApp, and delivers cash on delivery. Every day you decide what ONE short video should be, so that the video helps the shop sell, not just exist.

How selling works there: buyers discover on social media, ask the price or the delivery in the comments, close in DM or WhatsApp, and pay on delivery. The first seconds decide whether a video is watched; one clear next step (WhatsApp or DM) decides whether it sells. A price left out of the video makes buyers ask in the comments (engagement); a shown price suits cheap items and offers.

Use ONLY the facts you are given: the calendar, the shop's products (with stock, questions and orders), what buyers asked, how the recent videos did, and the owner's notes. There is NO live market or competitor data: never claim any. When the data is thin, say so in your reason and choose the safe option.

Decide:
- objective: sell_product (push a product buyers ask about or order), clear_stock (only if the owner's notes say stock must move), new_arrival (a product added in the last 14 days), seasonal (an occasion within 14 days that fits this shop), trust (reasons to trust the shop: delivery, quality, honesty), engage (curiosity that gets buyers to ask), reactivate (nothing was posted lately).
- productId: one product id from the list that is in stock and has a photo, or null for a shop-wide video. Prefer demand (asked, orders) over novelty. Do not pick a product that had a video in the last 3 days unless nothing else is close.
- Vary: do not repeat the objective, the format or the hook of the last videos; if a recent video brought orders or many comments, learn from it; if it brought nothing, change something.
- why: one or two sentences in Central Kurdish (Sorani) for the shop owner: what this video is for and why today (name the occasion, the demand, or what the last videos showed). Plain words, no hype.
- format: one of hook_question, showcase, social_proof, offer, how_it_works, delivery_promise, behind_the_scenes.
- priceMode: engagement (leave the price out) or conversion (show it).
- cta: whatsapp, dm or comment.
- urgent: true only when there is a real reason to act today (an occasion, low stock from the owner's notes).
- avoid: up to three things the video must not do (for example "do not mention a discount", "do not repeat last week's hook").
- lookMood: two or three English words of mood for the look (for example "warm festive", "clean minimal").
- boost: worth = whether paying to promote this video is likely to be worth it (only when the shop has orders or messages to learn from); cities = the cities from the shop data to target; note = one Sorani sentence on how (who and when).

Reply with one JSON object only: {"objective","productId","why","format","priceMode","cta","urgent","avoid","lookMood","boost":{"worth","cities","note"}}`;

/** Orders plus buying messages in 60 days below which "worth boosting" is never claimed. */
const BOOST_MIN_SIGNALS = 10;

const FORMATS = ["hook_question", "showcase", "social_proof", "offer", "how_it_works", "delivery_promise", "behind_the_scenes"];

const str = (v: unknown, max: number) => (typeof v === "string" ? Array.from(v.trim().replace(/\s+/g, " ")).slice(0, max).join("") : "");

/** The model's plan, kept to what the shop can do: a real product, known words, short strings. */
export function validateBrief(raw: unknown, s: Signals, date: string, model: string): DailyBrief | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!(OBJECTIVES as readonly string[]).includes(String(r.objective))) return null;
  const product = typeof r.productId === "string" ? s.products.find((p) => p.id === r.productId) : null;
  const productId = product && product.inStock && product.hasPhoto ? product.id : null;
  const why = str(r.why, 300);
  if (!why) return null;
  const b = (r.boost ?? {}) as Record<string, unknown>;
  const known = new Set(s.shop.cities.map((c) => c.toLowerCase()));
  // Boosting is only worth suggesting when the shop has enough orders and messages to aim it with.
  const dataEnough = s.shop.orders60 + s.shop.messages60 >= BOOST_MIN_SIGNALS;
  return {
    date,
    objective: r.objective as Objective,
    productId,
    why,
    format: FORMATS.includes(String(r.format)) ? String(r.format) : "showcase",
    priceMode: r.priceMode === "conversion" ? "conversion" : "engagement",
    // "Message on WhatsApp" is only offered when the shop has a number to message.
    cta: r.cta === "dm" || r.cta === "comment" ? r.cta : s.shop.hasPhone ? "whatsapp" : "dm",
    urgent: r.urgent === true,
    avoid: (Array.isArray(r.avoid) ? r.avoid : []).map((x) => str(x, 90)).filter(Boolean).slice(0, 3),
    lookMood: str(r.lookMood, 40) || "warm",
    boost: {
      worth: b.worth === true && dataEnough,
      // Only cities the shop's own orders name: with no city data there is nothing to aim at.
      cities: (Array.isArray(b.cities) ? b.cities : []).filter((c): c is string => typeof c === "string" && known.has(c.toLowerCase())).slice(0, 5),
      note: str(b.note, 200),
    },
    source: "model",
    model,
  };
}

/** The plan without a model: the occasion that is close, else the product buyers ask about, else trust. */
export function ruleBrief(s: Signals, date: string): DailyBrief {
  const common = { date, avoid: [] as string[], lookMood: "warm", source: "rules" as const, model: "rules" };
  const boost = (worth: boolean) => ({ worth: worth && s.shop.orders60 + s.shop.messages60 >= BOOST_MIN_SIGNALS, cities: s.shop.cities.slice(0, 3), note: "" });
  const cta = (preferred: "whatsapp" | "dm"): "whatsapp" | "dm" => (preferred === "whatsapp" && !s.shop.hasPhone ? "dm" : preferred);
  const usable = s.products.filter((p) => p.inStock && p.hasPhoto);
  const fresh = (p: (typeof usable)[number]) => p.videoDaysAgo === null || p.videoDaysAgo >= 3;

  // An occasion leads the plan while it approaches and in its first days; a month-long one (Ramadan) does not fix every day's video.
  const occasion = s.calendar.events.find((e) => e.weight === "high" && ((e.phase === "during" && e.daysUntil >= -2) || (e.phase === "before" && e.daysUntil <= 14)));
  const demand = [...usable].filter(fresh).sort((a, b) => b.orders30 * 3 + b.asked14 - (a.orders30 * 3 + a.asked14))[0];
  const hot = demand && demand.orders30 + demand.asked14 > 0 ? demand : null;
  const fresher = usable.find((p) => p.ageDays <= 14 && fresh(p));
  const name = occasion ? OCCASION_KU[occasion.id] ?? occasion.label : "";

  if (occasion) {
    return { ...common, objective: "seasonal", productId: (hot ?? usable[0])?.id ?? null, why: `بۆنەی «${name}» نزیکە، بۆیە ڤیدیۆیەکی وەرزی دەکەین.`, format: "offer", priceMode: "conversion", cta: cta("whatsapp"), urgent: true, boost: boost(true) };
  }
  if (hot) {
    return { ...common, objective: "sell_product", productId: hot.id, why: `«${hot.name}» لە ماوەی ئەم دوو هەفتەیەدا زۆرترین پرسیار و داواکاری بوو، بۆیە ئەمڕۆ ئەوە پیشان دەدەین.`, format: "showcase", priceMode: hot.orders30 > 0 ? "conversion" : "engagement", cta: cta("whatsapp"), urgent: false, boost: boost(true) };
  }
  if (fresher) {
    return { ...common, objective: "new_arrival", productId: fresher.id, why: `«${fresher.name}» تازە زیادکراوە و ماوەیەکە ڤیدیۆی بۆ نەکراوە، بۆیە دەیناسێنین.`, format: "hook_question", priceMode: "engagement", cta: "dm", urgent: false, boost: boost(false) };
  }
  return { ...common, objective: "trust", productId: usable.find(fresh)?.id ?? null, why: "داتای فرۆشتن هێشتا کەمە، بۆیە ڤیدیۆیەکی متمانە دروست دەکەین: کوالیتی، گەیاندن و ڕاستگۆیی.", format: "delivery_promise", priceMode: "engagement", cta: cta("whatsapp"), urgent: false, boost: boost(false) };
}

export interface BriefResult {
  brief: DailyBrief;
  cached: boolean;
  signals?: Signals;
  /** A forced remake failed and the plan already made today was kept. */
  failed?: boolean;
}

/** A plan made by the rules (the model was down) is tried again with the model after this long. */
const RULES_PLAN_RETRY_MS = 10 * 60 * 1000;

/**
 * Today's plan for a store: from the day's cache, else made now (the model, or the rules when it
 * fails). `force` makes it again (the owner pressed refresh, or changed their notes).
 */
export async function getDailyBrief(input: {
  tenantId: string;
  storeId: string;
  tier: VideoTier;
  force?: boolean;
  now?: number;
  call?: DirectorCall;
  /** How long the model may take (a video being prepared cannot wait as long as the page can). */
  timeoutMs?: number;
  /** The store whose allowance pays for the call (the plan is always made by Haiku). */
  meter?: Meter;
}): Promise<BriefResult | null> {
  const now = input.now ?? Date.now();
  const date = baghdadDate(now);
  const name = `brief-${date}`;
  const saved = await readJson<DailyBrief>(input.tenantId, input.storeId, name);
  const today = saved && saved.date === date && saved.objective ? saved : null;
  if (!input.force && today) {
    // A plan the rules made while the model was down is given another chance with the model after a few minutes.
    const stale = today.source === "rules" && now - (today.madeAt ?? 0) > RULES_PLAN_RETRY_MS;
    if (!stale) return { brief: today, cached: true };
  }
  const notes = await loadMarketNotes(input.tenantId, input.storeId);
  const signals = await gatherSignals(input.storeId, notes, now);
  if (!signals) return null;
  let brief: DailyBrief | null = null;
  try {
    const call = input.call ?? defaultDirector("LITE", input.meter);
    const out = await call({ system: PLAN_SYSTEM, user: signalsText(signals), strength: "strong", maxTokens: 900, meter: input.meter }, input.timeoutMs ?? 20_000);
    brief = validateBrief(out.data, signals, date, out.model);
  } catch {
    brief = null;
  }
  // The model failed: a plan the model already made today is never replaced by the plain rules.
  if (!brief && today && today.source === "model") return { brief: today, cached: true, failed: true };
  const result: DailyBrief = { ...(brief ?? ruleBrief(signals, date)), madeAt: now };
  try {
    await writeJson(input.tenantId, input.storeId, name, result);
  } catch {
    /* the plan still works for this video; it is made again next time */
  }
  return { brief: result, cached: false, signals, ...(brief ? {} : input.force ? { failed: true } : {}) };
}

/** Today's plan only if it already exists (the page shows it without spending a model call). */
export async function readTodaysBrief(tenantId: string, storeId: string, now = Date.now()): Promise<DailyBrief | null> {
  const date = baghdadDate(now);
  const v = await readJson<DailyBrief>(tenantId, storeId, `brief-${date}`);
  return v && v.date === date ? v : null;
}

