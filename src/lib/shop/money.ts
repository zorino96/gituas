/** Languages the shop answers in: Sorani, Badini (Arabic script), Arabic, Kurdish in Latin letters, English. */
export type Lang = "ckb" | "kmr" | "ar" | "ku_latn" | "en";
export const LANGS: readonly Lang[] = ["ckb", "kmr", "ar", "ku_latn", "en"];

const EXPONENT: Record<string, number> = { IQD: 0, USD: 2 };
const ARABIC_SCRIPT = new Set<Lang>(["ckb", "kmr", "ar"]);

export function exponentOf(currency: string): number {
  return EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Arabic-Indic digits for Arabic-script languages, Western digits otherwise; decimals only when there are some. */
export function formatMoney(amountMinor: number, currency: string, lang: Lang): string {
  const cur = currency.toUpperCase();
  const exp = exponentOf(cur);
  const value = amountMinor / 10 ** exp;
  const arabic = ARABIC_SCRIPT.has(lang);
  const whole = Number.isInteger(value);
  const n = new Intl.NumberFormat(arabic ? "ar-IQ" : "en-US", {
    numberingSystem: arabic ? "arab" : "latn",
    minimumFractionDigits: whole ? 0 : exp,
    maximumFractionDigits: exp,
  }).format(value);
  if (cur === "USD") return arabic ? `${n} $` : `$${n}`;
  if (cur === "IQD") return arabic ? `${n} د.ع` : `${n} IQD`;
  return `${n} ${cur}`;
}
