// Text helpers shared by sources, clustering and the legal rules. Pure
// functions only: the editor imports the rules in the browser too.

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…", // …
  rsquo: "’", // ’
  lsquo: "‘", // ‘
  ldquo: "“", // “
  rdquo: "”", // ”
  laquo: "«", // «
  raquo: "»", // »
  ndash: "–", // –
  mdash: "—", // —
  zwnj: "‌", // zero-width non-joiner
};

function decodeEntity(name: string): string | null {
  if (name[0] === "#") {
    const hex = name[1] === "x" || name[1] === "X";
    const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  return NAMED[name.toLowerCase()] ?? null;
}

/** Tags removed, entities decoded, whitespace collapsed. */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, name: string) => decodeEntity(name) ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

// Harakat, superscript alef, tatweel.
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
// One spelling per letter, so Kurdish and Arabic spellings of a name meet.
const LETTERS: Record<string, string> = {
  "ي": "ی", // ي → ی
  "ى": "ی", // ى → ی
  "ك": "ک", // ك → ک
  "ة": "ه", // ة → ه
  "ە": "ه", // ە → ه
  "ھ": "ه", // ھ → ه
  "أ": "ا", // أ → ا
  "إ": "ا", // إ → ا
  "آ": "ا", // آ → ا
  "ڕ": "ر", // ڕ → ر (outlets differ on the heavy r)
  "ڵ": "ل", // ڵ → ل
};
const LETTER_RE = new RegExp(`[${Object.keys(LETTERS).join("")}]`, "g");

/** For matching only: lower case, no diacritics, one spelling per letter, ASCII digits, no punctuation. */
export function normalizeForMatch(s: string): string {
  return s
    .replace(/[‌‍]/g, "")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(LETTER_RE, (c) => LETTERS[c])
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function words(s: string): string[] {
  const n = normalizeForMatch(s);
  return n ? n.split(" ") : [];
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

export function shingles(ws: string[], n: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + n <= ws.length; i++) out.add(ws.slice(i, i + n).join(" "));
  return out;
}

const KURDISH_ONLY = /[ڕڵێۆەڤ]/; // ڕ ڵ ێ ۆ ە ڤ
const ARABIC_SCRIPT = /[؀-ۿ]/;

/** Good enough for grouping and filtering: Kurdish letters → ku, other Arabic script → ar, else en. */
export function guessLang(s: string): string {
  if (KURDISH_ONLY.test(s)) return "ku";
  if (ARABIC_SCRIPT.test(s)) return "ar";
  return "en";
}

const ASCII_WORD = /^[a-z0-9 ]+$/;

/** True when the text contains any keyword; no keywords lets everything through.
 * An all-ASCII keyword must start a word (so "us" doesn't match inside "business");
 * a keyword with other script (e.g. Kurdish suffixes) keeps plain substring matching. */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const ks = keywords.map(normalizeForMatch).filter(Boolean);
  if (!ks.length) return true;
  const t = normalizeForMatch(text);
  return ks.some((k) => (ASCII_WORD.test(k) ? (" " + t).includes(" " + k) : t.includes(k)));
}
