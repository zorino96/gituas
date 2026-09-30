import { exponentOf } from "./money";

const EASTERN = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(EASTERN.includes(d) ? EASTERN.indexOf(d) : PERSIAN.indexOf(d)));
}

/** What merchants type ("25,000", "٢٥٬٠٠٠", "19.99") → minor units, or null. IQD has no fractions. */
export function parsePrice(raw: string, currency: string): number | null {
  const t = toWesternDigits(raw).trim().replace(/[\s,٬،']/g, "").replace("٫", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const exp = exponentOf(currency);
  if (exp === 0 && t.includes(".")) return null;
  const n = Math.round(Number(t) * 10 ** exp);
  return n > 0 && n <= 1e12 ? n : null;
}

/** Reply samples as stored: trimmed, non-empty, at most five, each at most 300 characters. */
export function cleanSamples(xs: string[], max = 5, maxLen = 300): string[] {
  return xs.map((s) => s.trim()).filter(Boolean).slice(0, max).map((s) => Array.from(s).slice(0, maxLen).join(""));
}

/** Why a comment or DM is waiting for the merchant (outcomeReason → Sorani). */
export const REASON_LABEL: Record<string, string> = {
  negotiation: "داوای داشکاندن",
  complaint: "گلەیی",
  abuse: "جنێو",
  spam: "سپام",
  other: "پێویستی بە تۆیە",
  low_confidence: "دڵنیا نییە",
  no_product: "کارتی بەرهەم نییە",
  private_window: "درەنگە بۆ نامەی تایبەت",
  unclear: "ڕوون نییە",
  needs_you: "پێویستی بە تۆیە",
  no_action: "پێویستی بە تۆیە",
};

/** Flags meant for the merchant, as opposed to routine skips (self, switched off, expired, caps). */
export function needsYou(reason: string | null): boolean {
  return !!reason && reason in REASON_LABEL;
}
