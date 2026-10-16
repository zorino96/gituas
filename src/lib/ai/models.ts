// The only two models Gituas uses, both through kurd.gg (one key): Claude Haiku for everything, and
// Claude Opus only for stores on a plan that includes it (replies, analysis, video scripts).
//
// Prices here are an ASSUMPTION used to keep each store's monthly AI spending inside what its plan
// pays for: the public list price of the nearest tier, in USD per million tokens. kurd.gg's real
// rates are not published, so this is an upper bound. AI_PRICE_SCALE (env, default 1) scales every
// price at once when the real rate is known: 0.5 makes every allowance last twice as long.

export type AiTier = "haiku" | "opus";

export const DEFAULT_MODEL: Record<AiTier, string> = {
  haiku: "cc/claude-haiku-5-5",
  opus: "cc/claude-opus-5-5",
};

/**
 * Whether Opus may be used at all. AI_OPUS_ENABLED=0 makes all of Gituas Haiku-only (the key in use has no Opus): no call asks
 * for Opus, no plan's Opus part is spent, and the Max plan is not sold. Anything but "0" leaves Opus available.
 */
export function opusAvailable(): boolean {
  return process.env.AI_OPUS_ENABLED?.trim() !== "0";
}

/** The kurd.gg model id of a tier; the environment may name another model of the same tier. Opus is Haiku while Opus is switched off. */
export function modelFor(tier: AiTier): string {
  const useOpus = tier === "opus" && opusAvailable();
  const named = useOpus ? process.env.KURDGG_MODEL_OPUS : process.env.KURDGG_MODEL;
  return named?.trim() || DEFAULT_MODEL[useOpus ? "opus" : "haiku"];
}

/** Which tier a model id belongs to (anything that is not an Opus model is priced as Haiku). */
export function tierOfModel(model: string): AiTier {
  return /opus/i.test(model) ? "opus" : "haiku";
}

/** USD per million tokens, input and output. */
export const LIST_PRICE_PER_MTOK: Record<AiTier, { in: number; out: number }> = {
  haiku: { in: 1, out: 5 },
  opus: { in: 5, out: 25 },
};

/**
 * AI_PRICE_SCALE multiplies every recorded cost. Above 1 is always safe (it spends the allowance faster).
 * Below 1 would let real spend exceed the allowance, so it is floored at 0.6: lower it further in code only
 * after a month of the provider's invoices matches what is recorded.
 */
export function priceScale(): number {
  const v = Number(process.env.AI_PRICE_SCALE);
  return Number.isFinite(v) && v > 0 ? Math.min(10, Math.max(0.6, v)) : 1;
}

/**
 * What a call costs in micro-dollars (1 USD = 1,000,000). tokens x USD-per-million-tokens is
 * already micro-USD, so no unit conversion is needed. Rounded up, so a call is never free.
 */
export function microUsd(tier: AiTier, tokensIn: number, tokensOut: number): number {
  const p = LIST_PRICE_PER_MTOK[tier];
  return Math.max(1, Math.ceil((Math.max(0, tokensIn) * p.in + Math.max(0, tokensOut) * p.out) * priceScale()));
}

/**
 * Tokens of a text when the provider did not say. Sorani and Arabic script cost far more tokens
 * per character than English, so the estimate leans high: it is meant to over-count, not under-count.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2.3);
}
