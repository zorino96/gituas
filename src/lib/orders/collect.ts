// The bot collects an order's details from the buyer in DMs: name, phone, city,
// address and, when the product has several, the size/colour. The AI only pulls
// those fields out of what the buyer wrote; everything the bot sends is fixed
// copy plus values from the order and store rows, so it never invents a number.

import { completeJson } from "@/lib/ai/provider";
import { normalizePhone } from "@/lib/merchant/phone";
import { feeFor, type CardStore } from "@/lib/shop/compose";
import { formatMoney, type Lang } from "@/lib/shop/money";
import { cityIn, cityLabel, isCityCode } from "./cities";

export type Field = "name" | "phone" | "city" | "address" | "variant";
export type Step = "ask" | "confirm" | "done";

export interface CollectOrder {
  customerName: string;
  phone: string | null;
  city: string | null;
  address: string | null;
  productName: string;
  variantLabel: string;
  amountMinor: number;
  currency: string;
  collect: string | null;
}

export interface Details {
  name?: string;
  phone?: string;
  city?: string;
  address?: string;
  variant?: string;
  /** A phone number was written but is not a valid mobile. */
  badPhone?: boolean;
}

type InStock = { label: string; amountMinor: number; currency: string }[];

const COPY: Record<Lang, { ask: string; fields: Record<Field, string>; badPhone: string; summary: string; total: string; delivery: string; confirm: string; done: string }> = {
  ckb: {
    ask: "بۆ تەواوکردنی داواکارییەکەت تکایە ئەمانەمان بۆ بنووسە:",
    fields: { name: "ناوت", phone: "ژمارەی مۆبایل", city: "شار", address: "ناونیشانی وورد", variant: "قیاس/ڕەنگ" },
    badPhone: "ژمارەی مۆبایلەکە دروست نییە، تکایە دووبارە بینووسەوە.",
    summary: "داواکارییەکەت:",
    total: "کۆی گشتی",
    delivery: "گەیاندن",
    confirm: "ئەگەر هەمووی دروستە بنووسە «بەڵێ».",
    done: "سوپاس! داواکارییەکەت تۆمار کرا و بەم زووانە پەیوەندیت پێوە دەکەین 🌷",
  },
  kmr: {
    ask: "بۆ تمامکرنا داخوازیێ هیڤییە ڤان بۆ مە بنڤیسە:",
    fields: { name: "ناڤێ تە", phone: "ژمارا مۆبایلێ", city: "باژێر", address: "ناڤ و نیشان", variant: "قەبارە/ڕەنگ" },
    badPhone: "ژمارا مۆبایلێ نە دروستە، هیڤییە دووبارە بنڤیسە.",
    summary: "داخوازیا تە:",
    total: "کۆم",
    delivery: "گەهاندن",
    confirm: "ئەگەر هەمی دروستن بنڤیسە «بەلێ».",
    done: "سوپاس! داخوازیا تە هاتە تۆمارکرن و دێ زوو پەیوەندیێ ب تە کەین 🌷",
  },
  ar: {
    ask: "لإكمال طلبك يرجى إرسال:",
    fields: { name: "الاسم", phone: "رقم الموبايل", city: "المحافظة", address: "العنوان بالتفصيل", variant: "القياس/اللون" },
    badPhone: "رقم الموبايل غير صحيح، يرجى كتابته مرة أخرى.",
    summary: "طلبك:",
    total: "المجموع",
    delivery: "التوصيل",
    confirm: "إذا كان كل شيء صحيحاً اكتب «نعم».",
    done: "شكراً! تم تسجيل طلبك وسنتواصل معك قريباً 🌷",
  },
  ku_latn: {
    ask: "Bo tewawkirdinî dawakariyeket tikaye emaneman bo binûse:",
    fields: { name: "Nawit", phone: "Jimarey mobayl", city: "Shar", address: "Nawnîshan", variant: "Qiyas/Reng" },
    badPhone: "Jimarey mobayleke durust nîye, tikaye dubare bînûsewe.",
    summary: "Dawakariyeket:",
    total: "Koy gishtî",
    delivery: "Geyandin",
    confirm: "Eger hemûy durste binûse \"bełê\".",
    done: "Spas! Dawakariyeket tomar kira 🌷",
  },
  en: {
    ask: "To complete your order, please send us:",
    fields: { name: "Your name", phone: "Mobile number", city: "City", address: "Full address", variant: "Size/colour" },
    badPhone: "That mobile number isn't valid, please write it again.",
    summary: "Your order:",
    total: "Total",
    delivery: "Delivery",
    confirm: "If everything is right, reply \"yes\".",
    done: "Thank you! Your order is recorded and we'll contact you soon 🌷",
  },
};

const cityLang = (lang: Lang) => (lang === "ar" ? "ar" : lang === "en" || lang === "ku_latn" ? "en" : "ckb");
const YES = /^(بەڵێ|بەلێ|بلێ|ئا|ئەرێ|ئەری|باشە|دروستە|بەڵی|نعم|اي|ايه|إي|أكيد|تمام|yes|yeah|yep|ok|okay|bele|bełê|ere|👍|✅)[\s.!🌷🙏❤️]*$/i;

/** The buyer agreed to the summary. */
export function isYes(text: string): boolean {
  return YES.test(text.trim());
}

/** What the order still lacks. The name counts as missing while it is only the platform handle. */
export function missingFields(o: CollectOrder, handle: string | null, inStock: InStock): Field[] {
  const out: Field[] = [];
  if (!o.customerName.trim() || (handle && o.customerName === handle)) out.push("name");
  if (!o.phone) out.push("phone");
  if (!o.city) out.push("city");
  if (!o.address?.trim()) out.push("address");
  if (inStock.length > 1 && !inStock.some((v) => v.label === o.variantLabel)) out.push("variant");
  return out;
}

/** Validates the AI's extraction and adds what plain matching finds, so a dead AI still gets phone and city. */
export function parseDetails(ai: unknown, text: string, inStock: InStock): Details {
  const a = (ai && typeof ai === "object" ? ai : {}) as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? Array.from(v.trim()).slice(0, max).join("") : undefined);
  const d: Details = {};
  const name = s(a.name, 60);
  if (name) d.name = name;
  const address = s(a.address, 200);
  if (address) d.address = address;

  const rawPhone = s(a.phone, 30) ?? text.match(/[+0٠۰]?[\d٠-٩۰-۹][\d٠-٩۰-۹\s-]{8,16}/)?.[0];
  if (rawPhone) {
    const p = normalizePhone(rawPhone);
    if (p.ok) d.phone = p.digits;
    else d.badPhone = true;
  }

  const aiCity = s(a.city, 40);
  const city = aiCity && isCityCode(aiCity) ? aiCity : cityIn(aiCity ?? "") ?? cityIn(text);
  if (city) d.city = city;

  const aiVariant = s(a.variant, 40)?.toLowerCase();
  const variant = inStock.find((v) => v.label && (v.label.toLowerCase() === aiVariant || new RegExp(`(^|\\s)${v.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(text)));
  if (variant) d.variant = variant.label;
  return d;
}

const EXTRACT_SYSTEM = `A buyer is giving a small shop in Iraqi Kurdistan the details for an order, in Sorani, Badini, Arabic or English.
Return JSON only: {"name": string|null, "phone": string|null, "city": string|null, "address": string|null, "variant": string|null}.
- name: the person's own name, only when they state it. Never a product or a city.
- phone: the mobile number exactly as written.
- city: the Iraqi governorate as one of: erbil, sulaymaniyah, duhok, halabja, kirkuk, baghdad, basra, nineveh, anbar, babil, karbala, najaf, diyala, wasit, maysan, dhiqar, muthanna, qadisiyah, salahaddin. A town or district → its governorate.
- address: the street, district, landmark — whatever locates the house, without the governorate name.
- variant: the size or colour they chose, matching one of the options given.
Use null for anything they did not write. Never guess.`;

export function hasDetails(d: Details): boolean {
  return !!(d.name || d.phone || d.city || d.address || d.variant || d.badPhone);
}

/** The fields in one buyer message. Never throws: a failed AI call falls back to plain matching. */
export async function extractDetails(text: string, inStock: InStock): Promise<Details> {
  const t = text.trim().slice(0, 600);
  if (!t) return {};
  const options = inStock.map((v) => v.label).filter(Boolean);
  const user = `${options.length ? `Options: ${options.join(", ")}\n` : ""}"""${t}"""`;
  let ai: unknown = null;
  try {
    ai = (await completeJson({ system: EXTRACT_SYSTEM, user, strength: "fast", thinking: false, budgetMs: 20_000 })).data;
  } catch {
    // plain matching below
  }
  return parseDetails(ai, t, inStock);
}

/** The order with the new details on it. A variant choice also takes that variant's price. */
export function applyDetails<T extends CollectOrder>(o: T, d: Details, inStock: InStock): T {
  const v = d.variant ? inStock.find((x) => x.label === d.variant) : undefined;
  return {
    ...o,
    customerName: d.name ?? o.customerName,
    phone: d.phone ?? o.phone,
    city: d.city ?? o.city,
    address: d.address ?? o.address,
    ...(v ? { variantLabel: v.label, amountMinor: v.amountMinor, currency: v.currency } : {}),
  };
}

export function questionText(missing: Field[], lang: Lang, badPhone = false): string {
  const c = COPY[lang];
  return [badPhone ? c.badPhone : null, c.ask, ...missing.map((f) => `• ${c.fields[f]}`)].filter(Boolean).join("\n");
}

export function summaryText(o: CollectOrder, store: CardStore, lang: Lang): string {
  const c = COPY[lang];
  const fee = feeFor(store, o.city);
  const money = (m: number) => formatMoney(m, o.currency, lang);
  const sameCurrency = o.currency === store.deliveryCurrency;
  return [
    c.summary,
    [o.productName, o.variantLabel].filter(Boolean).join(" — ") || null,
    `${c.fields.name}: ${o.customerName}`,
    `${c.fields.phone}: +${o.phone}`,
    `${c.fields.city}: ${cityLabel(o.city, cityLang(lang))}`,
    `${c.fields.address}: ${o.address}`,
    fee != null ? `${c.delivery}: ${formatMoney(fee, store.deliveryCurrency, lang)}` : null,
    o.amountMinor > 0 && fee != null && sameCurrency ? `${c.total}: ${money(o.amountMinor + fee)}` : o.amountMinor > 0 ? `${c.total}: ${money(o.amountMinor)}` : null,
    "",
    c.confirm,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function doneText(lang: Lang): string {
  return COPY[lang].done;
}

/**
 * One step of the conversation: the order after this message, the next state, and
 * what to send. New details always come first, so "yes, but the address is …" updates
 * the order and shows the summary again instead of confirming the old one.
 */
export function nextStep(
  o: CollectOrder,
  d: Details,
  text: string,
  ctx: { handle: string | null; inStock: InStock; store: CardStore; lang: Lang },
): { order: CollectOrder; step: Step; reply: string } {
  const changed = hasDetails(d);
  // A new order was priced at the first variant in stock; with several, the buyer has to pick one.
  const start = o.collect == null && ctx.inStock.length > 1 && !d.variant ? { ...o, variantLabel: "", amountMinor: 0 } : o;
  const order = applyDetails(start, d, ctx.inStock);
  const missing = missingFields(order, ctx.handle, ctx.inStock);
  if (missing.length) return { order: { ...order, collect: "ask" }, step: "ask", reply: questionText(missing, ctx.lang, d.badPhone) };
  if (o.collect === "confirm" && !changed && isYes(text)) return { order: { ...order, collect: "done" }, step: "done", reply: doneText(ctx.lang) };
  return { order: { ...order, collect: "confirm" }, step: "confirm", reply: summaryText(order, ctx.store, ctx.lang) };
}
