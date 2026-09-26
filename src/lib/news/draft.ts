import { completeJson, type Strength } from "@/lib/ai/provider";
import { CARD_KINDS, CATEGORIES, type CardKind, type Draft } from "./types";

export const DRAFT_SYSTEM = `You are the news editor of a Kurdish news page. You write Central Kurdish (Sorani) in Arabic script with standard modern orthography (ە ێ ۆ ڕ ڵ ی), the way Kurdish news outlets write.
You receive a source headline and, when available, a short snippet, in any language. Write an ORIGINAL short news post:
- Facts only, neutral tone, no opinion. Never add a fact, number, name, title or place that is not in the input.
- Restate the facts in your own words. Do not translate sentence by sentence, and never copy the source's wording when it is already Kurdish.
- If there is no snippet, the body is one sentence that restates the headline and adds nothing.
- headline: at most 90 characters. body: 1 to 3 sentences, at most 400 characters.
- Use Eastern Arabic digits (٠١٢٣٤٥٦٧٨٩). Spell foreign names the way Kurdish media spell them.
- category: one of ${CATEGORIES.slice(0, -1).join("، ")}.
- cardKind: BREAKING only for an urgent event that has just happened (an attack, a disaster, a death, a sudden decision); STAT when one number is the heart of the story (give "stat": the number with its unit); QUOTE when a named person's statement is the heart (give "quote": a short faithful paraphrase, and "speaker": the name exactly as given in the input); otherwise STANDARD.
Return only JSON: {"headline":"","body":"","category":"","cardKind":"","stat":null,"quote":null,"speaker":null}`;

export function buildUserPrompt(item: { sourceName: string; title: string; snippet: string }): string {
  return `Source: ${item.sourceName}\nHeadline: ${item.title}\nSnippet: ${item.snippet || "(none)"}`;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? [...t].slice(0, max).join("") : null;
}

/** The AI's JSON as a Draft, or null when it is unusable. Lengths are clamped; the rules flag long text. */
export function validateDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = str(r.headline, 160);
  const body = str(r.body, 800);
  if (!headline || !body) return null;
  const category = (CATEGORIES as readonly string[]).includes(String(r.category)) ? String(r.category) : "گشتی";
  let cardKind: CardKind = CARD_KINDS.includes(r.cardKind as CardKind) ? (r.cardKind as CardKind) : "STANDARD";
  const stat = str(r.stat, 30);
  const quote = str(r.quote, 200);
  const speaker = str(r.speaker, 60);
  if (cardKind === "STAT" && !stat) cardKind = "STANDARD";
  if (cardKind === "QUOTE" && (!quote || !speaker)) cardKind = "STANDARD";
  return {
    headline,
    body,
    category,
    cardKind,
    stat: cardKind === "STAT" ? stat : null,
    quote: cardKind === "QUOTE" ? quote : null,
    speaker: cardKind === "QUOTE" ? speaker : null,
  };
}

export async function draftFor(
  item: { sourceName: string; title: string; snippet: string },
  strength: Strength,
): Promise<{ draft: Draft; model: string }> {
  const { data, model } = await completeJson({ system: DRAFT_SYSTEM, user: buildUserPrompt(item), strength });
  const draft = validateDraft(data);
  if (!draft) throw new Error("The AI returned an unusable draft");
  return { draft, model };
}
