import { cityLabel, isCityCode } from "@/lib/orders/cities";
import { formatMoney, type Lang } from "./money";
import type { Intent } from "./policy";

export interface CardVariant {
  label: string;
  amountMinor: number;
  currency: string;
  inStock: boolean;
}
export interface CardProduct {
  name: string;
  photos: string[];
  variants: CardVariant[];
}
export interface CardStore {
  deliveryFeeMinor: number | null;
  deliveryCurrency: string;
  deliveryTime: string | null;
  /** { "<city code>": minor units }, as stored (JSON, so checked before use). */
  deliveryCityFees?: unknown;
}
export interface FbElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  buttons?: { type: "web_url"; url: string; title: string }[];
}

interface Copy {
  hello: string;
  price: string;
  available: string;
  soldOut: string;
  delivery: string;
  freeDelivery: string;
  otherCities: string;
  order: string;
  orderButton: string;
  comma: string;
}

/** Fixed copy per language. Numbers never come from here — only from the product and store rows. */
export const COPY: Record<Lang, Copy> = {
  ckb: { hello: "سڵاو! ئەمە زانیارییەکانە:", price: "نرخ", available: "بەردەستە", soldOut: "نەماوە", delivery: "گەیاندن", freeDelivery: "گەیاندن بەخۆڕایی", otherCities: "شارەکانی تر", order: "بۆ داواکردن:", orderButton: "داواکردن", comma: "، " },
  kmr: { hello: "سلاڤ! ئەڤە پێزانینن:", price: "بها", available: "هەیە", soldOut: "نەمایە", delivery: "گەهاندن", freeDelivery: "گەهاندن بێ بەرامبەر", otherCities: "باژێرێن دی", order: "بۆ داخوازکرنێ:", orderButton: "داخوازکرن", comma: "، " },
  ar: { hello: "أهلاً! هذه التفاصيل:", price: "السعر", available: "متوفر", soldOut: "نفد", delivery: "التوصيل", freeDelivery: "توصيل مجاني", otherCities: "باقي المحافظات", order: "للطلب:", orderButton: "اطلب الآن", comma: "، " },
  ku_latn: { hello: "Silaw! Eme zanyariyekane:", price: "Nirx", available: "Berdeste", soldOut: "Nemawe", delivery: "Geyandin", freeDelivery: "Geyandin bexorayî", otherCities: "Sharekanî tir", order: "Bo daway kirdin:", orderButton: "Daway bike", comma: ", " },
  en: { hello: "Hi! Here are the details:", price: "Price", available: "Available", soldOut: "Sold out", delivery: "Delivery", freeDelivery: "Free delivery", otherCities: "Other cities", order: "To order:", orderButton: "Order now", comma: ", " },
};

/** Used when the store has not written its own samples yet. */
export const DEFAULT_SAMPLES: Record<"answer" | "thanks", Record<Lang, string[]>> = {
  answer: {
    ckb: ["نامەمان بۆت نارد، سەیری نامەکانت بکە 🌷", "وردەکارییەکانمان لە نامەدا بۆت نارد 🙏"],
    kmr: ["مە نامە بۆ تە هنارت، سەح نامێن خۆ بکە 🌷"],
    ar: ["أرسلنا لك التفاصيل على الخاص 🌷", "تفقد رسائلك، أرسلنا لك كل التفاصيل 🙏"],
    ku_latn: ["Nameman bot nard, seyrî nameket bike 🌷"],
    en: ["We sent you the details in a message 🌷"],
  },
  thanks: {
    ckb: ["زۆر سوپاس 🌷", "دەستت خۆش بێت 🙏"],
    kmr: ["گەلەک سوپاس 🌷"],
    ar: ["شكراً جزيلاً 🌷", "تسلم 🙏"],
    ku_latn: ["Zor spas 🌷"],
    en: ["Thank you so much 🌷"],
  },
};

export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const priced = (v: CardVariant, lang: Lang) => (v.inStock ? formatMoney(v.amountMinor, v.currency, lang) : COPY[lang].soldOut);

function priceLines(p: CardProduct, lang: Lang): string[] {
  if (p.variants.length === 1 && !p.variants[0].label.trim()) return [`${COPY[lang].price}: ${priced(p.variants[0], lang)}`];
  return p.variants.map((v) => `• ${v.label}: ${priced(v, lang)}`);
}

/** The store's per-city fees, keeping only known cities with whole, non-negative amounts. */
export function cityFees(s: CardStore): Record<string, number> {
  const f = s.deliveryCityFees;
  if (!f || typeof f !== "object" || Array.isArray(f)) return {};
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => isCityCode(k) && Number.isInteger(v) && (v as number) >= 0)) as Record<string, number>;
}

/** What delivery to `city` costs: its own fee, else the store's one fee; null when the store set neither. */
export function feeFor(s: CardStore, city: string | null | undefined): number | null {
  const fees = cityFees(s);
  return city && city in fees ? fees[city] : s.deliveryFeeMinor;
}

const cityLang = (lang: Lang) => (lang === "ar" ? "ar" : lang === "en" || lang === "ku_latn" ? "en" : "ckb");

export function deliveryLine(s: CardStore, lang: Lang, city?: string | null): string | null {
  const c = COPY[lang];
  const minor = feeFor(s, city);
  const where = city && city in cityFees(s) ? ` (${cityLabel(city, cityLang(lang))})` : "";
  if (minor == null) return s.deliveryTime ? `${c.delivery}: ${s.deliveryTime}` : null;
  const fee = minor === 0 ? `${c.freeDelivery}${where}` : `${c.delivery}${where}: ${formatMoney(minor, s.deliveryCurrency, lang)}`;
  return s.deliveryTime ? `${fee} — ${s.deliveryTime}` : fee;
}

/** Every city's fee, for a buyer who asks about delivery without naming a city. */
function cityFeeLines(s: CardStore, lang: Lang): string[] {
  const c = COPY[lang];
  const money = (m: number) => (m === 0 ? c.freeDelivery : formatMoney(m, s.deliveryCurrency, lang));
  const lines = Object.entries(cityFees(s)).map(([city, m]) => `• ${cityLabel(city, cityLang(lang))}: ${money(m)}`);
  if (s.deliveryFeeMinor != null) lines.push(`• ${c.otherCities}: ${money(s.deliveryFeeMinor)}`);
  return [c.delivery, ...lines, ...(s.deliveryTime ? [s.deliveryTime] : [])];
}

const lines = (xs: (string | null)[]) => xs.filter((l): l is string => !!l).join("\n");

/** The private reply text (Instagram, and the Facebook fallback). */
export function dmText(i: { greeting: string; product: CardProduct; store: CardStore; lang: Lang; waUrl: string | null }): string {
  return lines([i.greeting, i.product.name, ...priceLines(i.product, i.lang), deliveryLine(i.store, i.lang), i.waUrl ? `${COPY[i.lang].order} ${i.waUrl}` : null]);
}

/** A follow-up DM answer from the card, or null when the card cannot answer it. */
export function answerText(intent: Intent, p: CardProduct, s: CardStore, lang: Lang, waUrl: string | null, city: string | null = null): string | null {
  const c = COPY[lang];
  let body: string[] = [];
  if (intent === "price") body = [p.name, ...priceLines(p, lang)];
  else if (intent === "delivery") {
    body = !city && Object.keys(cityFees(s)).length ? cityFeeLines(s, lang) : [deliveryLine(s, lang, city)].filter((l): l is string => !!l);
  }
  else if (intent === "size_colour" || intent === "availability") {
    const labels = p.variants.filter((v) => v.inStock && v.label.trim()).map((v) => v.label);
    body = [labels.length ? `${c.available}: ${labels.join(c.comma)}` : p.variants.some((v) => v.inStock) ? c.available : c.soldOut];
  }
  if (!body.length && !waUrl) return null;
  return lines([...body, waUrl ? `${c.order} ${waUrl}` : null]);
}

/** Facebook private reply: one generic-template element per variant, or per photo for a one-price product. */
export function fbCardElements(p: CardProduct, s: CardStore, lang: Lang, waUrl: string | null): FbElement[] {
  const delivery = deliveryLine(s, lang);
  const buttons = waUrl ? [{ type: "web_url" as const, url: waUrl, title: truncate(COPY[lang].orderButton, 20) }] : undefined;
  const subtitle = (first: string) => truncate([first, delivery].filter(Boolean).join(" · "), 80) || undefined;
  const photoAt = (i: number) => (p.photos.length ? p.photos[i % p.photos.length] : undefined);
  if (p.variants.length > 1) {
    return p.variants.slice(0, 10).map((v, i) => ({ title: truncate(`${p.name} — ${v.label}`, 80), subtitle: subtitle(priced(v, lang)), image_url: photoAt(i), buttons }));
  }
  const sub = subtitle(p.variants[0] ? priced(p.variants[0], lang) : "");
  const photos: (string | undefined)[] = p.photos.length ? p.photos.slice(0, 10) : [undefined];
  return photos.map((url) => ({ title: truncate(p.name, 80), subtitle: sub, image_url: url, buttons }));
}

/** Pre-filled WhatsApp text: the product and the price the buyer was quoted. */
export function waText(p: CardProduct, lang: Lang): string {
  const v = p.variants.find((x) => x.inStock);
  return v ? `${p.name} — ${formatMoney(v.amountMinor, v.currency, lang)}` : p.name;
}
