// The two switches of the owner rules. Both are environment strings read at call time (never cached), like the other feature
// switches in this repo (src/lib/advideo/enabled.ts, src/lib/chat/enabled.ts).

/** Opt-in: rules run only when SHOP_RULES_ENABLED is exactly "1". Off, the buyer pipeline behaves exactly as it did before rules. */
export function rulesEnabled(): boolean {
  return process.env.SHOP_RULES_ENABLED === "1";
}

/** Shadow mode: rules are evaluated and logged, nothing is sent, flagged or paused. Used for the first week of a rollout. */
export function rulesDryRun(): boolean {
  return process.env.RULES_DRY_RUN === "1";
}
