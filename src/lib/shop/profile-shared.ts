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
/** A typed line: control and direction characters out, spaces folded, cut to length. */
export function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/[\u0000-\u001F\u007F‎‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim();
  return t ? Array.from(t).slice(0, max).join("") : null;
}

/** A link, a handle or a phone number in a typed fact: a reply may never carry one, so such a fact is refused. */
const LINK_OR_PHONE = /(https?:\/\/|www\.|[\p{L}\p{N}-]+\.[a-z]{2,}\b|@[\p{L}\p{N}_.]{3,}|\d[\d\s-]{6,}\d)/iu;
const toWestern = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/** What an owner's input may become: only known ids, short clean text, no link or phone inside a fact. */
export function sanitizePatch(input: unknown): ProfilePatch {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: ProfilePatch = {};
  if ("goal" in r) out.goal = one(GOALS, r.goal);
  if ("goalText" in r) out.goalText = cleanLine(r.goalText, GOAL_TEXT_MAX);
  if ("category" in r) out.category = one(CATEGORIES, r.category);
  if ("offerLine" in r) out.offerLine = cleanLine(r.offerLine, OFFER_MAX);
  if ("customer" in r) out.customer = many(CUSTOMERS, r.customer);
  if ("sellsTo" in r) {
    const codes = new Set(CITIES.map((c) => c.code));
    out.sellsTo = Array.isArray(r.sellsTo) ? [...new Set(r.sellsTo.filter((c): c is string => typeof c === "string" && codes.has(c)))].slice(0, 19) : [];
  }
  if ("language" in r) out.language = one(PROFILE_LANGS, r.language);
  if ("tone" in r) out.tone = one(TONES, r.tone);
  if ("facts" in r && Array.isArray(r.facts)) {
    const facts: Fact[] = [];
    let customs = 0;
    for (const f of r.facts) {
      const x = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const on = x.on === true;
      if (x.k === "payment" && one(PAYMENTS, x.v)) facts.push({ k: "payment", v: x.v as string, on });
      else if (x.k === "returns" && one(RETURNS, x.v)) facts.push({ k: "returns", v: x.v as string, on });
      else if (x.k === "custom" && customs < MAX_CUSTOM_FACTS) {
        const text = cleanLine(x.v, CUSTOM_MAX);
        if (text && !LINK_OR_PHONE.test(toWestern(text))) {
          facts.push({ k: "custom", v: text, on });
          customs++;
        }
      }
    }
    out.facts = facts;
  }
  return out;
}

/** The interview was finished (the owner confirmed the last screen). */
export const interviewDone = (p: Profile | null): boolean => !!p?.interview.doneAt;

// ---- what is told to buyers -------------------------------------------------------------------------

type FactTable = Record<string, Partial<Record<Lang, string>> & { ckb: string; ar: string; en: string }>;

const PAYMENT_TEXT: FactTable = {
  cod: { ckb: "پارەدان لە کاتی گەیاندندا ئەکرێت.", ar: "الدفع عند الاستلام متاح.", en: "Cash on delivery is available." },
  transfer: { ckb: "پارەدان بە گواستنەوەی بانکی یان ئەپی پارە ئەکرێت.", ar: "الدفع بالتحويل المصرفي أو بمحفظة إلكترونية متاح.", en: "Payment by bank transfer or a mobile wallet is available." },
  pickup: { ckb: "دەتوانیت خۆت بێیت و بەرهەمەکە وەربگریت.", ar: "يمكنك الاستلام من المحل بنفسك.", en: "You can collect the order yourself." },
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
 * The profile as prompt lines. For a buyer reply (`audience: "buyer"`) only what a buyer may be told or what shapes the
 * wording: the offer, the customers, the cities, the tone and the switched-on facts in the buyer's language. For the
 * owner's own tools (`"owner"`) the goal as well. Cut to PROFILE_LINES_MAX_CHARS; the facts are cut last.
 */
export function profileLines(p: Profile | null, o: { lang: Lang; audience: "buyer" | "owner" }): string[] {
  if (!p) return [];
  const cities = p.sellsTo.map((c) => CITIES.find((x) => x.code === c)?.en).filter(Boolean);
  const head: string[] = [];
  if (p.category) head.push(`Business type: ${CATEGORY_EN[p.category]}.`);
  if (p.offerLine) head.push(`What they offer: ${p.offerLine}`);
  if (p.customer.length) head.push(`Customers: ${p.customer.map((c) => CUSTOMER_EN[c]).join(", ")}.`);
  if (cities.length && cities.length < 19) head.push(`Delivers to: ${cities.join(", ")}.`);
  if (p.tone) head.push(`Tone: ${TONE_EN[p.tone]}.`);
  if (o.audience === "owner" && (p.goalText || p.goal)) head.push(`The owner's goal with Gituas: ${p.goalText ?? p.goal}.`);
  const facts = p.facts.filter((f) => f.on).map((f) => factText(f, o.lang)).filter((t): t is string => !!t);
  const factLines = facts.length ? ["The owner confirmed these facts; the shop may tell them to buyers:", ...facts.map((t) => `- ${t}`)] : [];
  const fit = (lines: string[]) => lines.join("\n").length <= PROFILE_LINES_MAX_CHARS;
  let all = [...head, ...factLines];
  // Cut the head lines from the end first, then the facts from the end.
  while (!fit(all) && head.length) {
    head.pop();
    all = [...head, ...factLines];
  }
  while (!fit(all) && factLines.length > 1) {
    factLines.pop();
    all = [...head, ...factLines];
  }
  return fit(all) ? all : [];
}
