// One call shape for JSON completions, and one provider: kurd.gg, with two models only (see
// ./models.ts): Claude Haiku for everything, and Claude Opus for workspaces whose plan includes it.
// When kurd.gg cannot answer (an outage, busy, slow, a reply that does not fit), DeepSeek answers instead (./deepseek.ts);
// it is a stand-by only: it is tried after kurd.gg has failed, never before, and never past a refused allowance.
//
// A call made for a workspace carries a `meter`: its monthly AI allowance is checked before the call
// and charged after it (./meter.ts). When the allowance is used up the call is refused with
// AiUnavailable, and the feature's own fallback (fixed templates, plain rules) takes over.
import { altAllows, altJson, altModels, AltReplyError } from "./alt";
import { deepseekAllows, deepseekJson, DeepseekReplyError } from "./deepseek";
import { kurdggConfigured, kurdggJson, KurdggReplyError, MIN_MAX_TOKENS } from "./kurdgg";
import { chooseTier, recordSpend, type Meter } from "./meter";
import { noteRouterFailure, routerAllows, routerJson } from "./router";
import { estimateTokens, opusAvailable, type AiTier } from "./models";

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
  /**
   * May go to the free router first (./router.ts). Only for work on PUBLIC news content: a free gateway can keep what
   * it is sent, so a buyer's message, a voice note or an order never sets this. "light" = classifying, filtering,
   * picking; "draft" = also writing the news drafts and video scripts (a wider scope the owner switches on).
   */
  free?: "light" | "draft";
  /**
   * Opus for a system call that has no workspace allowance (the newsroom's drafts). "retry": Haiku first, and Opus when
   * its reply does not fit (a failed check); "always": Opus first, Haiku only when Opus fails. Ignored when a `meter` is
   * given: a workspace's allowance decides the model there.
   */
  opus?: "retry" | "always";
  /**
   * "video": the owner's order for AI video scripts (see videoOrder): DeepSeek V4.1 Flash first (its own API, then the free one
   * of the gateway), then the gateway's Claude, then Haiku, then the other alternative models. The steps that cannot take a call
   * with pictures are skipped, so that one goes to the main provider first.
   */
  prefer?: "video" | "kurdish" | "kurdish-video";
}

/**
 * The order of the steps for a call with prefer "video": deepseek (the DeepSeek API, V4.1 Flash), alt (every alternative model, in
 * ALT_AI_MODELS order), alt:<model id> (one of them), main (Haiku through the main key). AI_VIDEO_ORDER (comma list) changes it.
 * Whatever the list leaves out still runs afterwards in the ordinary order (main, DeepSeek, the other alternative models).
 */
export const DEFAULT_VIDEO_ORDER = "deepseek,alt:oc/deepseek-v4.1-flash-free,alt:cc/claude-haiku-5-5,main,alt";
/**
 * The order for every other call (the owner's choice, 2026-10-19): Haiku through the gateway first (his own key there), the official
 * Anthropic API he bought when the gateway cannot, then DeepSeek, then the other alternative models. AI_ORDER changes it.
 * A call that wants Opus skips the steps before "main" (they are Haiku), and a call with pictures skips the ones that cannot see.
 */
export const DEFAULT_MAIN_ORDER = "alt:cc/claude-haiku-5-5,main,deepseek,alt";
function parseOrder(raw: string | undefined, fallback: string): string[] {
  const out: string[] = [];
  for (const part of (raw?.trim() || fallback).split(",")) {
    const step = part.trim();
    if (/^(deepseek|main|alt|alt:[\w.:/@+-]{1,80})$/.test(step) && !out.includes(step)) out.push(step);
  }
  return out;
}
export const videoOrder = (): string[] => parseOrder(process.env.AI_VIDEO_ORDER, DEFAULT_VIDEO_ORDER);

/**
 * The order for TEXT THAT IS WRITTEN IN SORANI (the owner's choice, 2026-10-20: "for Kurdish text Gemini is the best"): Gemini 3.8 Flash
 * through the gateway first (measured on the six Sorani writing tasks: 98 % Kurdish words, the proofreader changed 0 % of them, against
 * Haiku's 97 % and 10 %), then the usual order. Gemini 3.1 Pro High (ag/gemini-3.1-pro-high) was unavailable (503, timeouts) when it was
 * measured: AI_KURDISH_ORDER puts it first when it is stable. A step that fails is left alone for 90 s, then the next one answers.
 */
export const DEFAULT_KURDISH_ORDER = "alt:ag/gemini-3.8-flash,alt:cc/claude-haiku-5-5,main,deepseek,alt";
export const kurdishOrder = (): string[] => parseOrder(process.env.AI_KURDISH_ORDER, DEFAULT_KURDISH_ORDER);
/**
 * The order for a Sorani VIDEO SCRIPT (prefer "kurdish-video", the owner's choice, 2026-10-24): Gemini writes the better Sorani, but on
 * a slow day it took 85 s for a script while the writer has 40; GPT-6 Luna answered the same prompt in 12 s. So Gemini gets the time
 * less what Luna needs (NEXT_ALT_RESERVE_MS), and Luna writes when Gemini runs out. The gateway's Haiku is left out: it returned
 * empty scripts (all 3600 tokens used, no text). AI_KURDISH_VIDEO_ORDER changes it.
 */
export const DEFAULT_KURDISH_VIDEO_ORDER = "alt:ag/gemini-3.8-flash,alt:cx/gpt-6-luna,main,deepseek,alt";
export const kurdishVideoOrder = (): string[] => parseOrder(process.env.AI_KURDISH_VIDEO_ORDER, DEFAULT_KURDISH_VIDEO_ORDER);
/** In the Sorani video order: the time a step leaves for the alternative model after it (Luna's script took 12 to 14 s). */
const NEXT_ALT_RESERVE_MS = 15_000;

/** Whether a call writes Sorani: the caller said so (prefer "kurdish"), or its prompt asks for Sorani / Central Kurdish text. */
export function writesSorani(call: Pick<JsonCall, "prefer" | "system">): boolean {
  if (call.prefer) return call.prefer === "kurdish" || call.prefer === "kurdish-video";
  return /sorani|central kurdish/i.test(call.system);
}
export const mainOrder = (): string[] => parseOrder(process.env.AI_ORDER, DEFAULT_MAIN_ORDER);

// A step that failed (the network, a timeout, a provider error) is left alone for a short while, so that every call does not wait
// for the same refusal before reaching the next one. Per server instance, like the router's cooling: the cost of a wrong guess is one call.
const COOL_MS = 90_000;
const coolUntil = new Map<string, number>();
const cooling = (key: string, now = Date.now()): boolean => (coolUntil.get(key) ?? 0) > now;
const cool = (key: string, now = Date.now()): void => void coolUntil.set(key, now + COOL_MS);
/** For tests. */
export function resetAiCooling(): void {
  coolUntil.clear();
}

/** The chat step (./chat.ts) leaves a failed provider alone for the same 90 s as the JSON steps do. */
export const stepCooling = cooling;
export const coolStep = cool;

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
/**
 * A stand-by try needs at least this long to be worth making. No time is kept back for it from kurd.gg's tries (a healthy
 * kurd.gg must get exactly the time it always had): it takes what is left, which after a failure is most of the budget.
 */
const STANDBY_MIN_MS = 4_000;
/** Time kept back for the main provider when DeepSeek is tried first (call.prefer): a DeepSeek that hangs must not cost Haiku its try. */
const PREFER_RESERVE_MS = 10_000;
/** The free router: how long one try may take, the least worth trying, and the time kept for kurd.gg after it. */
const ROUTER_TIMEOUT: Record<Strength, number> = { fast: 14_000, strong: 24_000 };
const ROUTER_MIN_MS = 5_000;
const ROUTER_PAID_RESERVE_MS = 22_000;

/** Failures that another try may fix: the network, the provider's own errors and its rate limit. */
function retryable(e: unknown): boolean {
  if ((e instanceof KurdggReplyError || e instanceof DeepseekReplyError) && e.truncated) return false; // the same cap would cut it again
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
  const viaRouter = routerAllows(call);
  if (!kurdggConfigured() && !viaRouter && !deepseekAllows(call) && !altAllows(call)) throw new AiUnavailable("no AI provider is configured");
  const start = Date.now();
  const deadlineMs = Math.min(DEADLINE_MS, Math.max(0, call.budgetMs ?? DEADLINE_MS));
  const remaining = () => deadlineMs - (Date.now() - start);

  // Free first: the router costs nothing, so it is tried before the allowance is looked at or anything is counted. Any
  // failure (quota, an outage, a slow answer, a reply that does not fit) goes on to kurd.gg below, with the time it needs.
  if (viaRouter) {
    const room = remaining() - ROUTER_PAID_RESERVE_MS;
    const timeout = Math.min(ROUTER_TIMEOUT[call.strength], room);
    if (timeout >= ROUTER_MIN_MS) {
      try {
        const result = await routerJson(call, timeout);
        const data = validate(result.data);
        if (data !== null) {
          console.info("[router] answered:", result.model);
          return { data, model: result.model };
        }
        console.error("[router] reply did not fit; kurd.gg takes over");
      } catch (e) {
        noteRouterFailure(e);
        // The status only: the text of an error can carry a piece of the gateway's reply.
        console.error("[router] failed; kurd.gg takes over:", /^HTTP \d{3}/.exec(message(e))?.[0] ?? (e instanceof Error ? e.name : "failed"));
      }
    }
  }
  // Without a kurd.gg key the stand-by is the provider (after the allowance check below).
  const kurdgg = kurdggConfigured();
  if (!kurdgg && !deepseekAllows(call) && !altAllows(call)) throw new AiUnavailable("the free router did not answer and no paid provider is configured");

  // The workspace's allowance decides the model and whether there is a call at all. A call with no
  // workspace to count it against is never Opus.
  // With Opus switched off (AI_OPUS_ENABLED=0) every call is Haiku, whatever the call or the plan asks for.
  let tier: AiTier = !opusAvailable() ? "haiku" : call.meter ? (call.tier ?? "haiku") : call.opus === "always" ? "opus" : "haiku";
  if (call.meter) {
    // If the count cannot be read the call is made with Haiku: a counting fault must not stop the shop answering.
    const allowed = await chooseTier(call.meter, tier, { essential: call.essential }).catch((): AiTier => "haiku");
    if (!allowed) throw new AiUnavailable("this month's AI allowance is used up");
    tier = allowed;
  }
  // The careful DeepSeek model stands in for Opus; the fast one for Haiku.
  const careful = tier === "opus";
  const standby = deepseekAllows(call);

  const spend = async (usage: { in: number; out: number } | undefined, used: AiTier) => {
    if (!call.meter || !usage) return;
    try {
      await recordSpend(call.meter, used, usage.in, usage.out);
    } catch {
      /* the answer is kept; the month's count is one call short */
    }
  };

  const errors: string[] = [];

  // DeepSeek: a stand-by after the main provider has failed, or (call.prefer) the first choice with the main provider after it.
  // Counted like a Haiku call (it costs less, so the allowance is never undercounted).
  const runDeepseek = async (tries: number, reserveMs: number, announce: boolean): Promise<{ data: T; model: string } | null> => {
    if (cooling("deepseek")) return null;
    for (let attempt = 0; attempt < tries; attempt++) {
      const timeout = Math.min(TIMEOUT[call.strength] * (careful ? OPUS_TIME : 1), remaining() - 500 - reserveMs);
      if (timeout < (attempt === 0 ? STANDBY_MIN_MS : MIN_RETRY_MS)) break;
      // Only the HTTP status or "no usable reply" is logged: the text of an error can carry a piece of the model's reply.
      if (announce && attempt === 0) console.warn("[ai] kurd.gg did not answer; DeepSeek takes over:", errors.map((e) => /^HTTP \d{3}/.exec(e)?.[0] ?? "no usable reply").join(" | ") || "not configured");
      try {
        const result = await deepseekJson(call, timeout, careful);
        await spend(result.usage, "haiku"); // paid for, whether or not the shape fits
        const data = validate(result.data);
        if (data !== null) return { data, model: result.model };
        errors.push("deepseek: the reply did not have the shape we need");
      } catch (e) {
        // A reply that arrived but could not be read was billed too; a call that timed out may have been: count a guess.
        if (e instanceof DeepseekReplyError) await spend(e.usage, "haiku");
        else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          await spend({ in: estimateTokens(`${call.system}${call.user}`), out: Math.ceil(Math.max(call.maxTokens ?? 2000, MIN_MAX_TOKENS) / 2) }, "haiku");
        }
        errors.push(`deepseek: ${message(e)}`);
        if (!(e instanceof DeepseekReplyError)) cool("deepseek");
        if (!retryable(e)) break;
      }
    }
    return null;
  };

  // An alternative model: one try, counted like a Haiku call (also a reply that was billed but unusable, and a timeout).
  const triedAlt = new Set<string>();
  const runAlt = async (model: string, reserveMs: number): Promise<{ data: T; model: string } | null> => {
    triedAlt.add(model);
    if (cooling(`alt:${model}`)) return null;
    const timeout = Math.min(TIMEOUT[call.strength], remaining() - 500 - reserveMs);
    if (timeout < STANDBY_MIN_MS) return null;
    try {
      const result = await altJson(call, timeout, model);
      await spend(result.usage, "haiku");
      const data = validate(result.data);
      if (data !== null) return { data, model: result.model };
      errors.push("alt: the reply did not have the shape we need");
    } catch (e) {
      if (e instanceof AltReplyError) await spend(e.usage, "haiku");
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        await spend({ in: estimateTokens(`${call.system}${call.user}`), out: Math.ceil(Math.max(call.maxTokens ?? 2000, MIN_MAX_TOKENS) / 2) }, "haiku");
      }
      errors.push(`alt: ${message(e)}`);
      if (!(e instanceof AltReplyError)) cool(`alt:${model}`);
    }
    return null;
  };

  let deepseekDone = false;
  // AI_KURDISH_ORDER=off switches the Sorani order off (every call then follows AI_ORDER).
  const kurdishVideo = call.prefer === "kurdish-video";
  const steps = call.prefer === "video" ? videoOrder() : kurdishVideo ? kurdishVideoOrder() : writesSorani(call) && process.env.AI_KURDISH_ORDER?.trim() !== "off" ? kurdishOrder() : mainOrder();
  // A call that wants Opus goes to the main provider first: the steps before it (outside the video order) are Haiku.
  if (steps.length && !(tier === "opus" && call.prefer !== "video" && !kurdishVideo)) {
    // The owner's order: every step before "main" gets one try, with time kept back for the main provider after it.
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step === "main") break;
      // (The Sorani video order keeps time for the next alternative model instead, only when this step still gets 15 s itself: a
      // short call, an ad's 20 s, goes whole to the first model.)
      const reserve = kurdishVideo
        ? steps[i + 1]?.startsWith("alt:") && remaining() >= 2 * NEXT_ALT_RESERVE_MS ? NEXT_ALT_RESERVE_MS : 0
        : kurdgg && steps.slice(i + 1).includes("main") ? PREFER_RESERVE_MS : 0;
      if (step === "deepseek") {
        if (standby && !deepseekDone) {
          deepseekDone = true;
          const r = await runDeepseek(1, reserve, false);
          if (r) return r;
        }
      } else if (altAllows(call)) {
        for (const m of step === "alt" ? altModels() : [step.slice(4)]) {
          if (triedAlt.has(m)) continue;
          const r = await runAlt(m, reserve);
          if (r) return r;
        }
      }
    }
  }

  for (let attempt = 0; kurdgg && attempt < 2; attempt++) {
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
        else if (call.opus === "retry" && !call.meter && opusAvailable()) tier = "opus";
        continue;
      }
      return { data, model: result.model };
    } catch (e) {
      // A reply that arrived but could not be read was paid for too.
      if (e instanceof KurdggReplyError) await spend(e.usage, tier);
      // A call that timed out may still have been generated and billed: a cautious guess is counted, so a slow
      // Opus drains its own allowance instead of costing money nobody sees.
      else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
        await spend({ in: estimateTokens(`${call.system}${call.user}`), out: Math.ceil(Math.max(call.maxTokens ?? 2000, MIN_MAX_TOKENS) / 2) }, tier);
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

  // The main provider did not answer: DeepSeek takes over (unless it was already the first choice).
  if (standby && !deepseekDone) {
    const second = await runDeepseek(2, 0, true);
    if (second) return second;
  }

  // Then the owner's alternative models (those not tried yet), one after the other, each with one try.
  if (altAllows(call)) {
    const rest = altModels().filter((m) => !triedAlt.has(m));
    if (rest.length) console.warn("[ai] main provider and DeepSeek did not answer; trying the alternative models");
    for (const m of rest) {
      const r = await runAlt(m, 0);
      if (r) return r;
    }
  }
  // Only the HTTP status or the kind of failure is logged: the text of an error can carry a piece of a reply.
  console.error("[ai] no provider answered:", errors.map((e) => /^((deepseek|alt): )?HTTP \d{3}/.exec(e)?.[0] ?? (/^(deepseek|alt):/.test(e) ? `${e.split(":")[0]}: no usable reply` : "no usable reply")).join(" | ") || "none tried");
  throw new AiUnavailable(errors.join("; ") || "the AI did not answer");
}
