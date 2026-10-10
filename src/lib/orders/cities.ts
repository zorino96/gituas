// Iraq's governorates, for the orders page. The Kurdistan Region comes first
// because that is where most of our merchants sell; the rest follow roughly
// by size. `code` is what is stored on an Order, never the label.

export type CityLang = "ckb" | "ar" | "en";

export interface City {
  code: string;
  ckb: string;
  ar: string;
  en: string;
}

export const CITIES: readonly City[] = [
  { code: "erbil", ckb: "هەولێر", ar: "أربيل", en: "Erbil" },
  { code: "sulaymaniyah", ckb: "سلێمانی", ar: "السليمانية", en: "Sulaymaniyah" },
  { code: "duhok", ckb: "دهۆک", ar: "دهوك", en: "Duhok" },
  { code: "halabja", ckb: "هەڵەبجە", ar: "حلبجة", en: "Halabja" },
  { code: "kirkuk", ckb: "کەرکووک", ar: "كركوك", en: "Kirkuk" },
  { code: "baghdad", ckb: "بەغدا", ar: "بغداد", en: "Baghdad" },
  { code: "basra", ckb: "بەسرە", ar: "البصرة", en: "Basra" },
  { code: "nineveh", ckb: "نەینەوا (مووسڵ)", ar: "نينوى", en: "Nineveh (Mosul)" },
  { code: "anbar", ckb: "ئەنبار", ar: "الأنبار", en: "Anbar" },
  { code: "babil", ckb: "بابل", ar: "بابل", en: "Babylon" },
  { code: "karbala", ckb: "کەربەلا", ar: "كربلاء", en: "Karbala" },
  { code: "najaf", ckb: "نەجەف", ar: "النجف", en: "Najaf" },
  { code: "diyala", ckb: "دیالە", ar: "ديالى", en: "Diyala" },
  { code: "wasit", ckb: "واسیت", ar: "واسط", en: "Wasit" },
  { code: "maysan", ckb: "مەیسان", ar: "ميسان", en: "Maysan" },
  { code: "dhiqar", ckb: "زیقار", ar: "ذي قار", en: "Dhi Qar" },
  { code: "muthanna", ckb: "موسەننا", ar: "المثنى", en: "Muthanna" },
  { code: "qadisiyah", ckb: "قادسیە", ar: "القادسية", en: "Qadisiyah" },
  { code: "salahaddin", ckb: "سەلاحەدین", ar: "صلاح الدين", en: "Salahaddin" },
];

const BY_CODE = new Map(CITIES.map((c) => [c.code, c]));

export function isCityCode(code: string): boolean {
  return BY_CODE.has(code);
}

// Other ways buyers write a city, beside the three labels.
const ALIASES: Record<string, string[]> = {
  erbil: ["هەولیر", "اربيل", "اربیل", "hewler", "hawler"],
  sulaymaniyah: ["سلیمانی", "سليمانية", "slemani", "sulaimani"],
  duhok: ["دهوک", "دهۆک", "duhok", "dohuk"],
  nineveh: ["مووسڵ", "موسڵ", "الموصل", "موصل", "mosul"],
  kirkuk: ["کەرکوک", "كركوك", "kerkuk"],
};

const NAMES: [string, string][] = CITIES.flatMap((c) =>
  [c.ckb, c.ar, c.en, ...(ALIASES[c.code] ?? [])].map((n) => [n.replace(/\s*\(.*\)/, "").toLowerCase(), c.code] as [string, string]),
).sort((a, b) => b[0].length - a[0].length);

/** The city a buyer's message names, or null. */
export function cityIn(text: string): string | null {
  const t = text.toLowerCase();
  return NAMES.find(([n]) => t.includes(n))?.[1] ?? null;
}

/** The governorate's name in `lang`; an unknown or empty code gives "" so callers can decide what to show. */
export function cityLabel(code: string | null | undefined, lang: CityLang = "ckb"): string {
  if (!code) return "";
  return BY_CODE.get(code)?.[lang] ?? "";
}
