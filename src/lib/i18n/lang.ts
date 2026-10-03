// The language codes, with nothing else, so client and server code can share them.

export type Lang = "ckb" | "ar" | "en";

/** Every UI language, each named in itself, in the order the switches show them. */
export const LANGS: readonly { lang: Lang; label: string }[] = [
  { lang: "ckb", label: "کوردی" },
  { lang: "ar", label: "العربية" },
  { lang: "en", label: "English" },
];

/** English reads left to right; Sorani and Arabic right to left. */
export function dirOf(lang: Lang): "ltr" | "rtl" {
  return lang === "en" ? "ltr" : "rtl";
}
