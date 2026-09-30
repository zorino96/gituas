import { completeJson, type JsonCall } from "@/lib/ai/provider";
import { hasDigit } from "./digits";
import type { Lang } from "./money";

export type Completer = (call: JsonCall) => Promise<unknown>;

export const MAX_REPLY = 300;

const LANG_NAME: Record<Lang, string> = {
  ckb: "Central Kurdish (Sorani) in Arabic script",
  kmr: "Badini (Northern Kurdish) in Arabic script",
  ar: "Iraqi Arabic",
  ku_latn: "Kurdish written in Latin letters",
  en: "English",
};

const defaultCompleter: Completer = async (call) => (await completeJson(call)).data;

/**
 * Rewrite one of the merchant's samples so repeated replies do not read as a
 * bot (and are not flagged as spam). The rewrite must pass the guard — no
 * digits, at most MAX_REPLY characters — or the sample goes out verbatim.
 */
export async function varySample(sample: string, lang: Lang, complete: Completer = defaultCompleter): Promise<{ text: string; ai: boolean }> {
  try {
    const data = await complete({
      system: `You rewrite a short reply that a shop posts on social media. Write it in ${LANG_NAME[lang]}. Keep the meaning and the warm tone, change the wording. One or two short sentences, at most one emoji. Never write any number, price, size or phone number. Return JSON {"text": "..."}.`,
      user: `"""${sample.slice(0, MAX_REPLY)}"""`,
      strength: "fast",
      thinking: false,
    });
    const out = (data as { text?: unknown } | null)?.text;
    const text = typeof out === "string" ? out.trim() : "";
    if (text && text.length <= MAX_REPLY && !hasDigit(text)) return { text, ai: true };
  } catch {
    /* the merchant's own words are always a safe answer */
  }
  return { text: sample, ai: false };
}
