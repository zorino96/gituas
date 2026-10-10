// What a Studio picture costs the shop, so that every picture pays for itself and leaves the owner
// at least the agreed margin — whatever the Higgsfield bill turns out to be.
//
//   price (IQD) = Higgsfield cost (USD) × IQD per USD × (1 + margin) ÷ (1 − payment fee), rounded up to 250
//
// The shop pays first (a Wayl top-up into its Studio balance); a picture only starts when the
// balance covers its price, and a failed or blocked picture is refunded. So the money that reaches
// the owner's card through Wayl is always more than what Higgsfield takes from it.
// Every input can be changed in the environment without a code change.

const num = (v: string | undefined, fallback: number, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

export interface PriceInputs {
  /** What Higgsfield charges for one generation, in USD (set high rather than low). */
  costUsd: number;
  /** IQD per USD at the rate the owner's card is charged, with room for the card's own fee. */
  iqdPerUsd: number;
  /** The owner's profit on top of the cost: 0.30 = 30 %. */
  margin: number;
  /** The share Wayl keeps of each top-up: 0.04 = 4 %. */
  payFee: number;
}

/** The price in IQD, rounded UP to the next 250 so rounding never eats the margin. */
export function priceFromCost(i: PriceInputs): number {
  const raw = (i.costUsd * i.iqdPerUsd * (1 + i.margin)) / (1 - i.payFee);
  return Math.ceil(raw / 250) * 250;
}

/** The inputs from the environment, with careful defaults. */
export function imagePriceInputs(env: Record<string, string | undefined> = process.env): PriceInputs {
  return {
    // Marketing Studio Image at 1k / high: about $0.13–0.19 a picture in Higgsfield's token pricing; $0.20 leaves room.
    costUsd: num(env.HIGGSFIELD_IMAGE_COST_USD, 0.2, 0.001, 10),
    // The card's rate was 1,700 IQD per USD on 2026-10-10; 1,750 leaves room for a weaker dinar or the card's FX fee.
    iqdPerUsd: num(env.STUDIO_IQD_PER_USD, 1750, 1000, 5000),
    margin: num(env.STUDIO_MARGIN, 0.3, 0, 5),
    payFee: num(env.STUDIO_PAY_FEE, 0.04, 0, 0.5),
  };
}

/** One Studio picture's price in IQD, and the Higgsfield cost it was worked out from. */
export function imagePrice(env: Record<string, string | undefined> = process.env): { priceIqd: number; costUsd: number } {
  const inputs = imagePriceInputs(env);
  return { priceIqd: priceFromCost(inputs), costUsd: inputs.costUsd };
}

/** What the owner keeps from a price after Wayl's fee and the Higgsfield cost, as a share of that cost. */
export function marginOf(priceIqd: number, i: PriceInputs): number {
  const received = priceIqd * (1 - i.payFee);
  const cost = i.costUsd * i.iqdPerUsd;
  return received / cost - 1;
}
