// What a feature passes to completeJson so its call is counted against the workspace's monthly AI
// allowance, and made with Opus when the workspace's plan includes it and the feature is worth it.

import type { Meter } from "./meter";
import type { AiTier } from "./models";

export interface AiOptions {
  tier: AiTier;
  meter: Meter;
}

/**
 * Options for a call made for a workspace. `opus: true` asks for Claude Opus; the meter gives it only
 * when the workspace has a plan that includes it, and steps down to Haiku when the Opus part of the
 * month is used up. Everything else is Haiku.
 */
export function aiFor(owner: { tenantId: string }, opts: { opus?: boolean } = {}): AiOptions {
  return { tier: opts.opus ? "opus" : "haiku", meter: { scope: owner.tenantId } };
}

/** The same, from a workspace id (an analysis or a caption has no single store). */
export async function aiForTenant(tenantId: string, opts: { opus?: boolean } = {}): Promise<AiOptions> {
  return aiFor({ tenantId }, opts);
}
