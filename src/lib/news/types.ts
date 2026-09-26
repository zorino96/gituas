/** One story as a source returns it: headline and a short snippet, never article text. */
export interface RawItem {
  url: string;
  title: string;
  snippet: string;
  publishedAt: Date;
  lang: string | null;
  sourceName: string;
}

export type CardKind = "STANDARD" | "BREAKING" | "STAT" | "QUOTE";
export const CARD_KINDS: readonly CardKind[] = ["STANDARD", "BREAKING", "STAT", "QUOTE"];

/** The last entry is the fallback when the AI names something else. */
export const CATEGORIES = [
  "سیاسەت",
  "ئابووری",
  "ئاسایش",
  "وەرزش",
  "تەندروستی",
  "کۆمەڵایەتی",
  "جیهان",
  "تەکنەلۆژیا",
  "گشتی",
] as const;

export interface Draft {
  headline: string;
  body: string;
  category: string;
  cardKind: CardKind;
  stat: string | null;
  quote: string | null;
  speaker: string | null;
}
