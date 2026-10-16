// Mechanical slips that make a Sorani news text look careless, found without any AI: a Latin letter inside a Kurdish
// word ("باranی"), the Arabic letters ي ك ى ة (Kurdish writes ی ک ە), and a doubled alef ("مندااڵ"). A draft with one
// is written again before it is shown or posted. A whole Latin word (a name such as "OpenAI" or "CNN") is fine.

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿ]/;
const LATIN = /[A-Za-z]/;
/** Arabic-only letters that Kurdish orthography replaces: ي → ی, ك → ک, ى → ی, ة → ە. */
const FOREIGN_LETTERS = /[يكىة]/;
const DOUBLE_ALEF = /اا/;

export type KurdishDefect = "mixed-script" | "arabic-letter" | "double-alef";

/** The kinds of slip in a text; empty when there are none. */
export function kurdishDefects(text: string): KurdishDefect[] {
  const found = new Set<KurdishDefect>();
  for (const token of text.split(/[\s‌‏‎،,.;:!؟?()«»"'—–-]+/)) {
    if (!token) continue;
    if (ARABIC_SCRIPT.test(token) && LATIN.test(token)) found.add("mixed-script");
    if (FOREIGN_LETTERS.test(token)) found.add("arabic-letter");
    if (DOUBLE_ALEF.test(token)) found.add("double-alef");
  }
  return [...found];
}

export const hasKurdishDefects = (...texts: (string | null | undefined)[]): boolean => texts.some((t) => !!t && kurdishDefects(t).length > 0);
