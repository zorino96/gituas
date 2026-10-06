// The parts of news-by-prompt (./focus.ts) that the settings page in the browser needs too.

export const FOCUS_PROMPT_MAX = 300;
export const FILTER_MODES = ["KEYWORDS", "PROMPT"] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

export function isFilterMode(v: unknown): v is FilterMode {
  return typeof v === "string" && (FILTER_MODES as readonly string[]).includes(v);
}

/** Trimmed, one line, at most FOCUS_PROMPT_MAX characters; empty becomes null. */
export function cleanFocusPrompt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim().slice(0, FOCUS_PROMPT_MAX);
  return s || null;
}
