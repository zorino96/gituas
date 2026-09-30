// Iraq's governorates, for the orders page. The Kurdistan Region comes first
// because that is where most of our merchants sell; the rest follow roughly
// by size. `code` is what is stored on an Order, never the label.

export type CityLang = "ckb" | "ar";

export interface City {
  code: string;
  ckb: string;
  ar: string;
}

export const CITIES: readonly City[] = [
  { code: "erbil", ckb: "هەولێر", ar: "أربيل" },
  { code: "sulaymaniyah", ckb: "سلێمانی", ar: "السليمانية" },
  { code: "duhok", ckb: "دهۆک", ar: "دهوك" },
  { code: "halabja", ckb: "هەڵەبجە", ar: "حلبجة" },
  { code: "kirkuk", ckb: "کەرکووک", ar: "كركوك" },
  { code: "baghdad", ckb: "بەغدا", ar: "بغداد" },
  { code: "basra", ckb: "بەسرە", ar: "البصرة" },
  { code: "nineveh", ckb: "نەینەوا (مووسڵ)", ar: "نينوى" },
  { code: "anbar", ckb: "ئەنبار", ar: "الأنبار" },
  { code: "babil", ckb: "بابل", ar: "بابل" },
  { code: "karbala", ckb: "کەربەلا", ar: "كربلاء" },
  { code: "najaf", ckb: "نەجەف", ar: "النجف" },
  { code: "diyala", ckb: "دیالە", ar: "ديالى" },
  { code: "wasit", ckb: "واسیت", ar: "واسط" },
  { code: "maysan", ckb: "مەیسان", ar: "ميسان" },
  { code: "dhiqar", ckb: "زیقار", ar: "ذي قار" },
  { code: "muthanna", ckb: "موسەننا", ar: "المثنى" },
  { code: "qadisiyah", ckb: "قادسیە", ar: "القادسية" },
  { code: "salahaddin", ckb: "سەلاحەدین", ar: "صلاح الدين" },
];

const BY_CODE = new Map(CITIES.map((c) => [c.code, c]));

export function isCityCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** The governorate's name in `lang`; an unknown or empty code gives "" so callers can decide what to show. */
export function cityLabel(code: string | null | undefined, lang: CityLang = "ckb"): string {
  if (!code) return "";
  return BY_CODE.get(code)?.[lang] ?? "";
}
