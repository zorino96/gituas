// The "check everything" tool: the shapes and the small pure helpers its finders share. Nothing here touches the database.
//
// A finder looks at ONE area of the workspace with one or two cheap count-style queries, scoped by the workspace, and returns the
// findings it made (none = nothing wrong there). The tool (src/lib/chat/tools/reads-health.ts) runs all finders at once and
// reports what finished in time. Every sentence is built from our own numbers and labels: no customer's or feed's text is ever read.

import type { Lang } from "@/lib/i18n/lang";
import { num } from "@/lib/i18n/num";
import { plural } from "@/lib/i18n/plural";
import type { ChatKind } from "../types";

export type Severity = "high" | "medium" | "info";
export const RANK: Record<Severity, number> = { high: 0, medium: 1, info: 2 };

export interface Finding {
  /** A stable English key of the area (connections, posts, orders, ...): see AREA_LABEL for the person's words. */
  area: string;
  severity: Severity;
  /** One plain sentence in the person's language, with the number. */
  text: string;
  /** English, for the model: which chat tool or which screen puts it right (and what the model must not do on its own). */
  fix: string;
  /** An app screen path. */
  href?: string;
  /** A short plain "what to do", in the person's language. The person's list shows it under the sentence; the model reads `fix`. */
  todo?: string;
}

export interface HealthCtx {
  tenantId: string;
  lang: Lang;
  kind: ChatKind;
  /** "/app" for a shop, "/newsroom" for a news desk. */
  base: "/app" | "/newsroom";
  now: Date;
}

export interface Finder {
  area: string;
  run(c: HealthCtx): Promise<Finding[]>;
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const ago = (c: HealthCtx, ms: number): Date => new Date(c.now.getTime() - ms);

// ---------------------------------------------------------------------------------------------------------------------
// Words. Three languages: Sorani (ckb), Arabic (ar), English (en). Arabic keeps to Arabic letters and Sorani to Sorani letters.

export type Words = Record<Lang, string>;
export const words = (ckb: string, ar: string, en: string): Words => ({ ckb, ar, en });
export type Say<A extends unknown[]> = Record<Lang, (...a: A) => string>;
export const say = <A extends unknown[]>(ckb: (...a: A) => string, ar: (...a: A) => string, en: (...a: A) => string): Say<A> => ({ ckb, ar, en });

/** Arabic counted noun: 1 and 2 have forms of their own and no digit, 3-10 the plural, 11 and up the singular again. */
export interface ArNoun {
  one: string;
  /** Nominative dual (the subject of a sentence). */
  two: string;
  /** The dual after a preposition or in a possessive (defaults to `two`). */
  twoObl?: string;
  few: string;
  many: string;
}
export interface Noun {
  ckb: string;
  ar: ArNoun;
  en: readonly [one: string, many: string];
}

export const nEn = (n: number): string => n.toLocaleString("en-US");
/** "3 orders" in Sorani. */
export const K = (n: number, noun: Noun): string => `${num(n)} ${noun.ckb}`;
/** "3 orders" in Arabic; `oblique` after a preposition or as the second part of a possessive. */
export const A = (n: number, noun: Noun, oblique = false): string => {
  const f = noun.ar;
  if (n === 1) return f.one;
  if (n === 2) return oblique ? (f.twoObl ?? f.two) : f.two;
  return `${num(n)} ${plural(n, { one: f.one, two: f.two, few: f.few, many: f.many })}`;
};
/** "3 orders" in English. */
export const E = (n: number, noun: Noun): string => `${nEn(n)} ${n === 1 ? noun.en[0] : noun.en[1]}`;
/** is / are, has / have, ... */
export const be = (n: number): string => (n === 1 ? "is" : "are");
export const hv = (n: number): string => (n === 1 ? "has" : "have");
/** "There is / there are" in Arabic before a MASCULINE counted noun (comment, order, product): the verb agrees with a noun placed after it, so only 3 to 10 (the plural) takes the feminine "توجد". */
export const there = (n: number): string => (n >= 3 && n <= 10 ? "توجد" : "يوجد");

const noun = (ckb: string, ar: ArNoun, en: readonly [string, string]): Noun => ({ ckb, ar, en });

/** The things the findings count. */
export const N = {
  post: noun("پۆست", { one: "منشور واحد", two: "منشوران", twoObl: "منشورين", few: "منشورات", many: "منشوراً" }, ["post", "posts"]),
  scheduled: noun("پۆستی خشتەکراو", { one: "منشور مجدول واحد", two: "منشوران مجدولان", twoObl: "منشورين مجدولين", few: "منشورات مجدولة", many: "منشوراً مجدولاً" }, ["scheduled post", "scheduled posts"]),
  reply: noun("وەڵام", { one: "رد واحد", two: "ردان", twoObl: "ردين", few: "ردود", many: "رداً" }, ["reply", "replies"]),
  message: noun("نامە", { one: "رسالة واحدة", two: "رسالتان", twoObl: "رسالتين", few: "رسائل", many: "رسالة" }, ["message", "messages"]),
  comment: noun("کۆمێنت", { one: "تعليق واحد", two: "تعليقان", twoObl: "تعليقين", few: "تعليقات", many: "تعليقاً" }, ["comment", "comments"]),
  order: noun("داواکاریی نوێ", { one: "طلب جديد واحد", two: "طلبان جديدان", twoObl: "طلبين جديدين", few: "طلبات جديدة", many: "طلباً جديداً" }, ["new order", "new orders"]),
  product: noun("بەرهەمی چالاک", { one: "منتج فعّال واحد", two: "منتجان فعّالان", twoObl: "منتجين فعّالين", few: "منتجات فعّالة", many: "منتجاً فعّالاً" }, ["active product", "active products"]),
  shop: noun("دووکان", { one: "متجر واحد", two: "متجران", twoObl: "متجرين", few: "متاجر", many: "متجراً" }, ["shop", "shops"]),
  fbPage: noun("پەیجی فەیسبووک", { one: "صفحة فيسبوك واحدة", two: "صفحتا فيسبوك", twoObl: "صفحتي فيسبوك", few: "صفحات فيسبوك", many: "صفحة فيسبوك" }, ["Facebook Page", "Facebook Pages"]),
  igAccount: noun("ئەکاونتی ئینستاگرام", { one: "حساب إنستغرام واحد", two: "حسابا إنستغرام", twoObl: "حسابي إنستغرام", few: "حسابات إنستغرام", many: "حساب إنستغرام" }, ["Instagram account", "Instagram accounts"]),
  page: noun("پەیج", { one: "صفحة واحدة", two: "صفحتان", twoObl: "صفحتين", few: "صفحات", many: "صفحة" }, ["Page", "Pages"]),
  account: noun("ئەکاونت", { one: "حساب واحد", two: "حسابان", twoObl: "حسابين", few: "حسابات", many: "حساباً" }, ["account", "accounts"]),
  rule: noun("یاسا", { one: "قاعدة واحدة", two: "قاعدتان", twoObl: "قاعدتين", few: "قواعد", many: "قاعدةً" }, ["rule", "rules"]),
  time: noun("جار", { one: "مرة واحدة", two: "مرتان", twoObl: "مرتين", few: "مرات", many: "مرة" }, ["time", "times"]),
  action: noun("کار", { one: "إجراء واحد", two: "إجراءان", twoObl: "إجراءين", few: "إجراءات", many: "إجراءً" }, ["action", "actions"]),
  story: noun("هەواڵی نوێ", { one: "خبر جديد واحد", two: "خبران جديدان", twoObl: "خبرين جديدين", few: "أخبار جديدة", many: "خبراً جديداً" }, ["new story", "new stories"]),
  source: noun("سەرچاوە", { one: "مصدر واحد", two: "مصدران", twoObl: "مصدرين", few: "مصادر", many: "مصدراً" }, ["source", "sources"]),
  day: noun("ڕۆژ", { one: "يوم واحد", two: "يومان", twoObl: "يومين", few: "أيام", many: "يوماً" }, ["day", "days"]),
  hour: noun("کاتژمێر", { one: "ساعة واحدة", two: "ساعتان", twoObl: "ساعتين", few: "ساعات", many: "ساعة" }, ["hour", "hours"]),
} as const;

/** What a finding is built from: its words in three languages and the English fix for the model. */
export interface Def {
  area: string;
  severity: Severity;
  text: Say<[n: number]>;
  todo: Words;
  fix: string;
}

/** Makes the finding of a definition, in the person's language. */
export function found(c: HealthCtx, d: Def, n: number, href?: string): Finding {
  return { area: d.area, severity: d.severity, text: d.text[c.lang](n), fix: d.fix, todo: d.todo[c.lang], ...(href ? { href } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the person reads around the findings.

/** The areas, in the person's words (the model reads the English key). */
export const AREA_LABEL: Record<string, Words> = {
  connections: words("پەیوەندییەکان", "الربط", "Connections"),
  posts: words("پۆستە شکستخواردووەکان", "المنشورات الفاشلة", "Failed posts"),
  scheduled: words("پۆستە خشتەکراوەکان", "المنشورات المجدولة", "Scheduled posts"),
  outbox: words("ناردنی وەڵامەکان", "إرسال الردود", "Sending replies"),
  inbox: words("کۆمێنت و نامەکان", "التعليقات والرسائل", "Comments and messages"),
  orders: words("داواکارییەکان", "الطلبات", "Orders"),
  products: words("بەرهەمەکان", "المنتجات", "Products"),
  settings: words("ڕێکخستنەکان", "الإعدادات", "Settings"),
  rules: words("یاساکان", "القواعد", "Rules"),
  chat_actions: words("کارەکانی چات", "إجراءات المحادثة", "Chat actions"),
  autopilot: words("ئۆتۆپایلۆت", "الطيار الآلي", "Autopilot"),
  sources: words("سەرچاوەکانی هەواڵ", "مصادر الأخبار", "News sources"),
  plan: words("پلان", "الخطة", "Plan"),
};
export const areaLabel = (area: string, lang: Lang): string => AREA_LABEL[area]?.[lang] ?? area;

export const SEVERITY_BADGE: Record<Severity, Words> = {
  high: words("پەلە", "عاجل", "Urgent"),
  medium: words("گرنگ", "مهم", "Soon"),
  info: words("ئاگاداری", "للعلم", "FYI"),
};

// ---------------------------------------------------------------------------------------------------------------------
// Meta connections, read from the stored credentials (no call to Facebook or Instagram).

export interface CredRow {
  provider: string;
  providerAccountId: string;
  expiresAt: Date | null;
}
export interface MetaAccount {
  provider: "META_FACEBOOK" | "META_INSTAGRAM";
  id: string;
  /** Some stored credential of this account has not expired. */
  live: boolean;
  /** When the newest live credential ends; null = it never expires (or the account is not live). */
  endsAt: Date | null;
}

/**
 * The Facebook Pages and Instagram accounts the workspace connected, one entry per account (a reconnect adds a row, so an account is
 * live when ANY of its rows is). Meta tokens cannot be refreshed: an expired row means "reconnect". Ad accounts ("act_...") are not Pages.
 */
export function metaAccounts(rows: readonly CredRow[], now: Date): Map<string, MetaAccount> {
  const seen = new Map<string, { acc: MetaAccount; never: boolean; latest: number }>();
  for (const r of rows) {
    if (r.provider !== "META_FACEBOOK" && r.provider !== "META_INSTAGRAM") continue;
    if (r.provider === "META_FACEBOOK" && r.providerAccountId.startsWith("act_")) continue;
    const key = `${r.provider}:${r.providerAccountId}`;
    const cur = seen.get(key) ?? { acc: { provider: r.provider, id: r.providerAccountId, live: false, endsAt: null }, never: false, latest: 0 };
    if (!r.expiresAt) {
      cur.acc.live = true;
      cur.never = true;
    } else if (r.expiresAt.getTime() > now.getTime()) {
      cur.acc.live = true;
      cur.latest = Math.max(cur.latest, r.expiresAt.getTime());
    }
    seen.set(key, cur);
  }
  const out = new Map<string, MetaAccount>();
  for (const [key, v] of seen) out.set(key, { ...v.acc, endsAt: v.acc.live && !v.never && v.latest ? new Date(v.latest) : null });
  return out;
}

/** The live Facebook Pages whose connection ends within `withinMs`. */
export function endingSoon(accounts: Iterable<MetaAccount>, now: Date, withinMs: number): MetaAccount[] {
  return [...accounts].filter((a) => a.provider === "META_FACEBOOK" && a.live && a.endsAt !== null && a.endsAt.getTime() - now.getTime() <= withinMs);
}
