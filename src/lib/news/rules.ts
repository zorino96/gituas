// The legal rules of the news desk, enforced in code (spec: "Legal rules").
// Pure: the editor runs checkDraft live in the browser, and the server runs it
// again before a card is accepted.
import { shingles, words } from "./text";

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
  if (tw.length < N) return (" " + sw.join(" ") + " ").includes(" " + tw.join(" ") + " ") ? 1 : 0;
  const a = shingles(tw, N);
  const b = shingles(sw, N);
  let shared = 0;
  for (const s of a) if (b.has(s)) shared++;
  return shared / a.size;
}

function lcsLength(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Longest common subsequence of the two word lists, as a share of the text's word count. 0 when either is empty. */
export function sequenceRatio(text: string, source: string): number {
  const tw = words(text);
  const sw = words(source);
  if (!tw.length || !sw.length) return 0;
  return lcsLength(tw, sw) / tw.length;
}

const HEADLINE_SEQ_RATIO = 0.8;
const BODY_SEQ_RATIO = 0.6;

export type CopyPart = "headline" | "body" | "both" | null;

/** Which part of the draft copies the source, if any, using exactly checkDraft's thresholds. */
export function copyPart(d: { headline: string; body: string }, src: { title: string; snippet: string }): CopyPart {
  const headline = d.headline.trim();
  const body = d.body.trim();
  const sourceText = `${src.title} ${src.snippet}`;
  const headlineCopy = words(headline).length >= 3 && sequenceRatio(headline, src.title) >= HEADLINE_SEQ_RATIO;
  const bodyCopy =
    overlapRatio(`${headline} ${body}`, sourceText) >= COPY_RATIO ||
    (words(body).length >= 4 && sequenceRatio(body, sourceText) >= BODY_SEQ_RATIO);
  if (headlineCopy && bodyCopy) return "both";
  if (headlineCopy) return "headline";
  if (bodyCopy) return "body";
  return null;
}

const COPY_MESSAGE: Record<Exclude<CopyPart, null>, string> = {
  headline: "سەردێڕەکە زۆر لە سەردێڕی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە.",
  body: "دەقەکە زۆر لە دەقی سەرچاوەکە دەچێت. بە وشەی خۆت بینووسەوە.",
  both: "سەردێڕ و دەقەکە زۆر لە سەرچاوەکە دەچن. بە وشەی خۆت بینووسەوە.",
};

/** Every problem blocks publishing until the editor fixes it. */
export function checkDraft(d: { headline: string; body: string }, src: { title: string; snippet: string }): Problem[] {
  const out: Problem[] = [];
  const headline = d.headline.trim();
  const body = d.body.trim();
  if (!headline || !body) out.push({ code: "EMPTY", message: "سەردێڕ و دەق هەردووکیان پێویستن." });
  if ([...headline].length > LIMITS.headline) out.push({ code: "HEADLINE_LONG", message: `سەردێڕ لە ${ku(LIMITS.headline)} پیت درێژترە.` });
  if ([...body].length > LIMITS.body) out.push({ code: "BODY_LONG", message: `دەق لە ${ku(LIMITS.body)} پیت درێژترە.` });
  const part = copyPart(d, src);
  if (part) {
    out.push({ code: "COPY", message: COPY_MESSAGE[part] });
  }
  return out;
}

/** The "source: name\nurl" line every news post ends with. */
export function attributionFor(source: { name: string; url: string }): string {
  return `سەرچاوە: ${source.name}\n${source.url}`;
}

/** The post text for every platform: headline, body, then the source and its link. */
export function captionFor(d: { headline: string; body: string }, source: { name: string; url: string }): string {
  return `${d.headline.trim()}\n\n${d.body.trim()}\n\n${attributionFor(source)}`;
}

/** The caption as typed, plus the source attribution — exactly what gets posted. */
export function captionWithAttribution(caption: string, source: { name: string; url: string }): string {
  return `${caption.trim()}\n\n${attributionFor(source)}`;
}
