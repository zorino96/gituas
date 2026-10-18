// The business profile: what the owner told Gituas about their work in the setup interview (/app/setup).
//
// Rules this file keeps:
//  - Nothing here is required. A store with no profile, the switch off, or any read error behaves exactly as before:
//    loadProfile() answers null and every caller must cope with null.
//  - Gituas never decides why someone uses it: the first answer is the owner's own goal (sell, grow an audience,
//    get enquiries, or something else in their words), and the later questions follow from it.
//  - Only the owner's confirmed `facts` can be told to buyers. A chip is a fixed sentence (no numbers) written in the
//    buyer's language when it is used; a typed fact carries the owner's own words. Each fact has its own switch.
//  - Short on purpose: the lines that go into a reply or a caption are capped, because every reply pays for them.

import { CITIES } from "@/lib/orders/cities";
import type { Lang } from "./money";

export const profileEnabled = (): boolean => process.env.BUSINESS_PROFILE_ENABLED?.trim() === "1";

export const GOALS = ["sell", "grow", "leads", "other"] as const;
export type Goal = (typeof GOALS)[number];
export const CATEGORIES = ["fashion", "beauty", "electronics", "food", "home", "kids", "jewelry", "health", "education", "services", "content", "other"] as const;
export const CUSTOMERS = ["women", "men", "youth", "parents", "families", "businesses", "everyone"] as const;
export const TONES = ["friendly", "formal", "direct"] as const;
export const PROFILE_LANGS = ["ckb", "ar"] as const;
export const PAYMENTS = ["cod", "transfer", "pickup"] as const;
export const RETURNS = ["none", "exchange", "refund"] as const;

export type Category = (typeof CATEGORIES)[number];
export type Customer = (typeof CUSTOMERS)[number];
export type Tone = (typeof TONES)[number];

export interface Fact {
  k: "payment" | "returns" | "custom";
  v: string;
  on: boolean;
}

export interface Interview {
  /** The screen the owner is on (0 = the first). */
  step: number;
  answered: string[];
  skipped: string[];
  /** ISO time the owner confirmed the last screen. */
  doneAt?: string;
}

export interface Profile {
  storeId: string;
  goal: Goal | null;
  goalText: string | null;
  category: Category | null;
  offerLine: string | null;
  customer: Customer[];
  sellsTo: string[];
  language: (typeof PROFILE_LANGS)[number] | null;
  tone: Tone | null;
  facts: Fact[];
  interview: Interview;
}

/** The fields the interview writes. All optional: a screen saves only its own. */
export type ProfilePatch = Partial<Omit<Profile, "storeId">>;

const OFFER_MAX = 140;
const GOAL_TEXT_MAX = 200;
const CUSTOM_MAX = 160;
const MAX_CUSTOM_FACTS = 3;

const one = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const many = <T extends string>(list: readonly T[], v: unknown): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === "string" && (list as readonly string[]).includes(x)))] : []);
/**
 * Characters that show nothing but can hide a link or a number from a check: controls, soft hyphen, zero-width space and
 * joiner, word joiner and the invisible math signs, bidi marks, the BOM and the "tag" block. The zero-width NON-joiner
 * (U+200C) stays: Kurdish and Persian need it.
 */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u200B\u200D-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu;

/** A typed line: invisible characters out, spaces folded, cut to length (the raw text is cut first: it may be huge). */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // Line breaks and tabs are spaces; every other invisible character is simply removed (so it cannot split a link in two).
  const t = v.slice(0, max * 4).replace(/[\r\n\t\v\f]/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  return t ? Array.from(t).slice(0, max).join("") : null;
}

const toWestern = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * A link, an account handle or a phone number in a typed text. A reply or a caption may never carry one, so text that has
 * one is refused. Look-alike characters are folded first (NFKC), digits of every script count, and any separator may sit
 * between the digits of a phone number.
 */
export function hasLinkOrPhone(text: string): boolean {
  const t = toWestern(text.replace(INVISIBLE, "").normalize("NFKC"));
  if (/(https?:\/\/|www\.|[\p{L}\p{N}-]+\.[a-z]{2,}\b|@[\p{L}\p{N}_.]{3,})/iu.test(t)) return true;
  return /\d{7,}/.test(t.replace(/[\s.,/()\-–—·_\u060C\u066B\u066C\u200C]/g, ""));
}

const MAX_FACTS_RAW = 30;

/** What an owner's input may become: only known ids, short clean text, no link or phone inside any typed text. */
export function sanitizePatch(input: unknown): ProfilePatch {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: ProfilePatch = {};
  const typed = (v: unknown, max: number): string | null => {
    const t = cleanLine(v, max);
    return t && !hasLinkOrPhone(t) ? t : null;
  };
  if ("goal" in r) out.goal = one(GOALS, r.goal);
  if ("goalText" in r) out.goalText = typed(r.goalText, GOAL_TEXT_MAX);
  if ("category" in r) out.category = one(CATEGORIES, r.category);
  if ("offerLine" in r) out.offerLine = typed(r.offerLine, OFFER_MAX);
  if ("customer" in r) out.customer = many(CUSTOMERS, r.customer);
  if ("sellsTo" in r) {
    const codes = new Set(CITIES.map((c) => c.code));
    out.sellsTo = Array.isArray(r.sellsTo) ? [...new Set(r.sellsTo.slice(0, 60).filter((c): c is string => typeof c === "string" && codes.has(c)))].slice(0, 19) : [];
  }
  if ("language" in r) out.language = one(PROFILE_LANGS, r.language);
  if ("tone" in r) out.tone = one(TONES, r.tone);
  if ("facts" in r && Array.isArray(r.facts)) {
    // At most one fact per chip, one returns rule, and three typed facts: nine in all, whatever was sent.
    const facts: Fact[] = [];
    const seen = new Set<string>();
    let customs = 0;
    let returns = 0;
    for (const f of r.facts.slice(0, MAX_FACTS_RAW)) {
      const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const on = x.on === true;
      if (x.k === "payment" && one(PAYMENTS, x.v) && !seen.has(`p:${x.v}`)) {
        seen.add(`p:${x.v}`);
        facts.push({ k: "payment", v: x.v as string, on });
      } else if (x.k === "returns" && one(RETURNS, x.v) && returns === 0) {
        returns++;
        facts.push({ k: "returns", v: x.v as string, on });
      } else if (x.k === "custom" && customs < MAX_CUSTOM_FACTS) {
        const text = typed(x.v, CUSTOM_MAX);
        if (text && !seen.has(`c:${text}`)) {
          seen.add(`c:${text}`);
          facts.push({ k: "custom", v: text, on });
          customs++;
        }
      }
    }
    out.facts = facts;
  }
  return out;
}

const factKey = (f: Pick<Fact, "k" | "v">) => `${f.k}:${f.v}`;

/**
 * The facts after a screen saves them: a fact already switched on stays on (the owner confirmed it before); a new one is
 * stored OFF until the owner confirms the review screen; one that was taken out is gone. The client's `on` flags are
 * never trusted here, only at finishInterviewAction.
 */
export function mergeFacts(previous: Fact[], incoming: Fact[]): Fact[] {
  const was = new Map(previous.map((f) => [factKey(f), f.on]));
  return incoming.map((f) => ({ k: f.k, v: f.v, on: was.get(factKey(f)) === true }));
}

/** The interview was finished (the owner confirmed the last screen). */
export const interviewDone = (p: Profile | null): boolean => !!p?.interview.doneAt;

// ---- what is told to buyers -------------------------------------------------------------------------

type FactTable = Record<string, Partial<Record<Lang, string>> & { ckb: string; ar: string; en: string }>;

const PAYMENT_TEXT: FactTable = {
  cod: { ckb: "پارەدان لە کاتی گەیاندندا ئەکرێت.", ar: "الدفع عند الاستلام متاح.", en: "Cash on delivery is available." },
  transfer: { ckb: "پارەدان بە گواستنەوەی بانکی یان ئەپی پارە ئەکرێت.", ar: "الدفع بالتحويل المصرفي أو بمحفظة إلكترونية متاح.", en: "Payment by bank transfer or a mobile wallet is available." },
  pickup: { ckb: "دەتوانیت خۆت بێیت و بەرهەمەکە وەربگریت.", ar: "يمكنك استلام الطلب بنفسك.", en: "You can collect the order yourself." },
};
const RETURNS_TEXT: FactTable = {
  none: { ckb: "کاڵای فرۆشراو ناگەڕێندرێتەوە.", ar: "البضاعة المباعة لا تُسترجع.", en: "Sold items are not returned." },
  exchange: { ckb: "ئەگەر کێشەی هەبوو، کاڵاکە دەگۆڕدرێتەوە.", ar: "إذا كان فيه مشكلة تُستبدل البضاعة.", en: "If there is a problem, the item is exchanged." },
  refund: { ckb: "ئەگەر کێشەی هەبوو، پارەکە دەگەڕێندرێتەوە.", ar: "إذا كان فيه مشكلة يُرجع المبلغ.", en: "If there is a problem, the money is returned." },
};

/** One fact as a sentence in the buyer's language (a typed fact is the owner's own words); null for an unknown id. */
export function factText(f: Fact, lang: Lang): string | null {
  if (f.k === "custom") return f.v;
  const t = (f.k === "payment" ? PAYMENT_TEXT : RETURNS_TEXT)[f.v];
  if (!t) return null;
  return t[lang] ?? (lang === "kmr" || lang === "ku_latn" ? t.ckb : t.en);
}

const CATEGORY_EN: Record<Category, string> = {
  fashion: "clothes and fashion", beauty: "beauty and care", electronics: "electronics", food: "food and drinks", home: "home and furniture", kids: "kids",
  jewelry: "jewelry and accessories", health: "health and clinics", education: "education and courses", services: "a service", content: "a content channel", other: "other",
};
const CUSTOMER_EN: Record<Customer, string> = { women: "women", men: "men", youth: "young people", parents: "parents", families: "families", businesses: "businesses", everyone: "everyone" };
const TONE_EN: Record<Tone, string> = { friendly: "warm and friendly", formal: "polite and formal", direct: "short and direct" };

/** The hard cap on the lines that go into a prompt: they are paid for on every reply. */
export const PROFILE_LINES_MAX_CHARS = 700;

/**
 * The profile as prompt lines; nothing until the owner has finished the interview (what is saved on the way is not
 * "confirmed" yet). `audience`:
 *  - "buyer": a reply to a buyer: the offer, the customers, the cities, the tone and the switched-on facts, the facts in
 *    the buyer's language;
 *  - "caption": a public post: only what the page is about (type, offer, customers, tone), never the facts, the cities or the goal;
 *  - "owner": the owner's own tools: the buyer lines and the goal.
 * Cut to PROFILE_LINES_MAX_CHARS in one pass: the confirmed facts first, then the description in order of use.
 */
export function profileLines(p: Profile | null, o: { lang: Lang; audience: "buyer" | "caption" | "owner" }): string[] {
  if (!p || !interviewDone(p)) return [];
  const budget = PROFILE_LINES_MAX_CHARS;
  const factLines: string[] = [];
  if (o.audience !== "caption") {
    const texts = p.facts.filter((f) => f.on).map((f) => factText(f, o.lang)).filter((t): t is string => !!t);
    if (texts.length) {
      factLines.push("The owner confirmed these facts; the shop may tell them to buyers:");
      let used = factLines[0].length;
      for (const t of texts) {
        const line = `- ${t}`;
        if (used + 1 + line.length > budget) break;
        factLines.push(line);
        used += 1 + line.length;
      }
      if (factLines.length === 1) factLines.length = 0;
    }
  }
  const cities = p.sellsTo.map((c) => CITIES.find((x) => x.code === c)?.en).filter(Boolean);
  const candidates: string[] = [];
  if (p.category) candidates.push(`Business type: ${CATEGORY_EN[p.category]}.`);
  if (p.offerLine) candidates.push(`What they offer: ${p.offerLine}`);
  if (p.customer.length) candidates.push(`Mainly for: ${p.customer.map((c) => CUSTOMER_EN[c]).join(", ")}.`);
  if (p.tone) candidates.push(`Tone: ${TONE_EN[p.tone]}.`);
  if (o.audience !== "caption" && cities.length && cities.length < 19) candidates.push(`Usually delivers to: ${cities.join(", ")}.`);
  if (o.audience === "owner" && (p.goalText || p.goal)) candidates.push(`The owner's goal with Gituas: ${p.goalText ?? p.goal}.`);
  const head: string[] = [];
  let used = factLines.reduce((n, l) => n + l.length + 1, 0);
  for (const l of candidates) {
    if (used + l.length + 1 > budget) continue;
    head.push(l);
    used += l.length + 1;
  }
  return [...head, ...factLines];
}
