// One call shape for JSON completions, and one provider: kurd.gg, with two models only (see
// ./models.ts): Claude Haiku for everything, and Claude Opus for workspaces whose plan includes it.
//
// A call made for a workspace carries a `meter`: its monthly AI allowance is checked before the call
// and charged after it (./meter.ts). When the allowance is used up the call is refused with
// AiUnavailable, and the feature's own fallback (fixed templates, plain rules) takes over.
import { kurdggConfigured, kurdggJson, KurdggReplyError } from "./kurdgg";
import { chooseTier, recordSpend, type Meter } from "./meter";
import { estimateTokens, type AiTier } from "./models";

export type { Meter } from "./meter";
export type { AiTier } from "./models";

/** fast = a short answer is expected; strong = a long, careful one (a longer time limit, never another model). */
export type Strength = "fast" | "strong";

export interface JsonCall {
  system: string;
  user: string;
  strength: Strength;
  /** Ignored: kept so older call sites keep compiling. */
  thinking?: boolean;
  /** At most this long overall (ms), for side calls that must not outlive their caller. Default 50 s. */
  budgetMs?: number;
  /** An exact kurd.gg model id instead of the one the tier picks. */
  model?: string;
  /** Pictures the model should look at: https URLs or data: URLs, after the text of `user`. */
  images?: string[];
  /** The model the caller wants: Haiku unless the call is worth Opus (and the workspace's plan has it). */
  tier?: AiTier;
  /** The workspace this call is for. Without it the call is not counted (system tasks), and is made with Haiku. */
  meter?: Meter;
  /**
   * The work that must go on even in a busy month (labelling a buyer's message, reading order details):
   * it may use the whole allowance, while the other features stop at a share of it.
   */
  essential?: boolean;
  /** The longest answer to accept, in tokens. Every use case should set it: a runaway reply costs money. */
  maxTokens?: number;
}

export interface JsonResult {
  data: unknown;
  model: string;
  /** Tokens read and written, as the provider counted them (or as estimated). */
  usage?: { in: number; out: number };
}

export class AiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailable";
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One try's time limit before it is clamped to what the deadline allows. */
const TIMEOUT: Record<Strength, number> = { fast: 18_000, strong: 30_000 };
/** Opus thinks longer; its calls get a third more time. */
const OPUS_TIME = 1.35;
const DEADLINE_MS = 50_000;
/** A second try is made only when it can still get at least this long. */
const MIN_RETRY_MS = 8_000;
/** Time kept back from an Opus try so that a Haiku try can still follow it. */
const HAIKU_RESERVE_MS = 9_000;

/** Failures that another try may fix: the network, the provider's own errors and its rate limit. */
function retryable(e: unknown): boolean {
  if (e instanceof KurdggReplyError && e.truncated) return false; // the same cap would cut it again
  if (!(e instanceof Error)) return false;
  if (e.name === "TimeoutError" || e.name === "AbortError") return false; // already used its time
  const m = /^HTTP (\d{3})/.exec(e.message);
  if (m) return Number(m[1]) === 429 || Number(m[1]) >= 500;
  return true; // the network, an empty reply, a reply that was not JSON
}

export async function completeJson<T = unknown>(
  call: JsonCall,
  validate: (data: unknown) => T | null = (d) => d as T,
): Promise<{ data: T; model: string }> {
  if (!kurdggConfigured()) throw new AiUnavailable("no AI provider is configured");
  const start = Date.now();
  const deadlineMs = Math.min(DEADLINE_MS, Math.max(0, call.budgetMs ?? DEADLINE_MS));
  const remaining = () => deadlineMs - (Date.now() - start);

  // The workspace's allowance decides the model and whether there is a call at all. A call with no
  // workspace to count it against is never Opus.
  let tier: AiTier = call.meter ? (call.tier ?? "haiku") : "haiku";
  if (call.meter) {
    // If the count cannot be read the call is made with Haiku: a counting fault must not stop the shop answering.
    const allowed = await chooseTier(call.meter, tier, { essential: call.essential }).catch((): AiTier => "haiku");
    if (!allowed) throw new AiUnavailable("this month's AI allowance is used up");
    tier = allowed;
  }

  const spend = async (usage: { in: number; out: number } | undefined, used: AiTier) => {
    if (!call.meter || !usage) return;
    try {
      await recordSpend(call.meter, used, usage.in, usage.out);
    } catch {
      /* the answer is kept; the month's count is one call short */
    }
  };

  const errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const per = TIMEOUT[call.strength] * (tier === "opus" ? OPUS_TIME : 1);
    // An Opus try leaves room for a Haiku try after it: a slow or failing Opus never costs the whole answer.
    const room = remaining() - 1_000 - (tier === "opus" ? HAIKU_RESERVE_MS : 0);
    const timeout = Math.min(per, room);
    if (timeout < (attempt === 0 ? 4_000 : MIN_RETRY_MS)) {
      if (tier === "opus" && remaining() >= 5_000) {
        tier = "haiku"; // not enough time for Opus at all: Haiku, now
        attempt--;
        continue;
      }
      break;
    }
    try {
      const result = await kurdggJson(call, timeout, tier);
      await spend(result.usage, tier); // paid for, whether or not the shape fits
      const data = validate(result.data);
      if (data === null) {
        errors.push("the reply did not have the shape we need");
        if (tier === "opus") tier = "haiku";
        continue;
      }
      return { data, model: result.model };
    } catch (e) {
      // A reply that arrived but could not be read was paid for too.
      if (e instanceof KurdggReplyError) await spend(e.usage, tier);
      // A call that timed out may still have been generated and billed: a cautious guess is counted, so a slow
      // Opus drains its own allowance instead of costing money nobody sees.
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        await spend({ in: estimateTokens(`${call.system}${call.user}`), out: Math.ceil((call.maxTokens ?? 2000) / 2) }, tier);
      }
      errors.push(message(e));
      const truncated = e instanceof KurdggReplyError && e.truncated;
      // Opus failing for any reason (a timeout, a provider error, a model this key does not have) is
      // answered by Haiku once, within the time that was kept back for it.
      if (tier === "opus" && !truncated && attempt === 0 && remaining() >= MIN_RETRY_MS) {
        tier = "haiku";
        continue;
      }
      if (!retryable(e)) break;
    }
  }
  throw new AiUnavailable(errors.join("; ") || "the AI did not answer");
}
