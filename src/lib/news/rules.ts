// The legal rules of the news desk, enforced in code (spec: "Legal rules").
// Pure: the editor runs checkDraft live in the browser, and the server runs it
// again before a card is accepted.
import { normalizeForMatch, shingles, words } from "./text";

export const LIMITS = { headline: 120, body: 600 } as const;

const N = 4;
const COPY_RATIO = 0.5;

export type ProblemCode = "EMPTY" | "HEADLINE_LONG" | "BODY_LONG" | "COPY";

export interface Problem {
  code: ProblemCode;
  message: string;
}

const ku = (n: number) => new Intl.NumberFormat("ar-IQ").format(n);

/** Share of the text's word 4-grams that also appear in the source. Short texts are compared whole. */
export function overlapRatio(text: string, source: string): number {
  const tw = words(text);
  const sw = words(source);
  if (!tw.length || !sw.length) return 0;
  if (tw.length < N) return normalizeForMatch(source).includes(tw.join(" ")) ? 1 : 0;
  const a = shingles(tw, N);
  const b = shingles(sw, N);
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}

/** Every problem blocks publishing until the editor fixes it. */
export function checkDraft(d: { headline: string; body: string }, src: { title: string; snippet: string }): Problem[] {
  const out: Problem[] = [];
  const headline = d.headline.trim();
  const body = d.body.trim();
  if (!headline || !body) out.push({ code: "EMPTY", message: "سەردێڕ و دەق هەردووکیان پێویستن." });
  if ([...headline].length > LIMITS.headline) out.push({ code: "HEADLINE_LONG", message: `سەردێڕ لە ${ku(LIMITS.headline)} پیت درێژترە.` });
  if ([...body].length > LIMITS.body) out.push({ code: "BODY_LONG", message: `دەق لە ${ku(LIMITS.body)} پیت درێژترە.` });
  if (overlapRatio(`${headline} ${body}`, `${src.title} ${src.snippet}`) >= COPY_RATIO) {
    out.push({ code: "COPY", message: "ئەم دەقە زۆر لە دەقی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە." });
  }
  return out;
}

/** The post text for every platform: headline, body, then the source and its link. */
export function captionFor(d: { headline: string; body: string }, source: { name: string; url: string }): string {
  return `${d.headline.trim()}\n\n${d.body.trim()}\n\nسەرچاوە: ${source.name}\n${source.url}`;
}
