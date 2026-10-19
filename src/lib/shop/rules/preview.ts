// Preview and backtest: what a rule WOULD do, found out with the real matcher, the real engine and the free rule-based
// classifier (classifyByRules). No model is called anywhere here, so a preview costs nothing and stores nothing.
//
// A text the free classifier cannot label is the one thing a preview cannot know: the real pipeline asks a model for it. A
// declared example can say which label to assume ("as"); an extra sample without one is labelled "assumed" (an ordinary
// message) when the rule does not depend on labels, and unlabelled (the rule cannot be judged) when it does.

import { classifyByRules } from "../classify-rules";
import { COMMENT_TYPES, INTENTS, type Classification, type CommentType, type Intent } from "../policy";
import { LANGS } from "../money";
import { pickRule, type PickInput, type RuleReply, type RuleRecord } from "./engine";
import { needsLabel } from "./match";
import { scriptsOf } from "./fold";
import type { RuleSpecT } from "./spec";
import {
  BACKTEST_MIN_SAMPLE, BACKTEST_REFUSE, BACKTEST_WARN,
  type Lang, type LintIssue, type ReasonCode, type RuleChannel, type RulePlatform,
} from "./types";

/** Gives a label to a text, or null. The real one is classifyByRules; a test or a screen can pass stored labels instead. */
export type Classifier = (text: string) => Classification | null;

/** Where the label of a sample came from. */
export type LabelSource = "declared" | "classifier" | "assumed" | "none";

export interface PreviewSample {
  text: string;
  /** Label to assume for this text instead of asking the classifier. */
  as?: Partial<Classification>;
}

/** The conditions a preview pretends to be in. */
export interface PreviewContext {
  viaVoice?: boolean;
  hasProductCard?: boolean;
  canPrivateReply?: boolean;
}

export interface PreviewRow {
  text: string;
  /** One of the rule's own examples (as opposed to an extra sample). */
  declared: boolean;
  /** What the example says should happen; null for an extra sample. */
  expected: boolean | null;
  /** The trigger matched. */
  triggered: boolean;
  /** The rule would act: reply, flag, pause, or wait for its timer. */
  matches: boolean;
  /** expected === matches; null when there is no expectation. */
  ok: boolean | null;
  label: Classification | null;
  labelSource: LabelSource;
  /** The owner's text that would be sent, and how. Null when the rule would not reply. */
  sends: Pick<RuleReply, "text" | "textLang" | "lang" | "channel" | "publicLine"> | null;
  flags: boolean;
  pauses: boolean;
  waits: boolean;
  /** Why not (or what held a part back). */
  reasons: ReasonCode[];
}

export interface PreviewResult {
  rows: PreviewRow[];
  /** Every declared example behaves as declared. */
  examplesOk: boolean;
  /** The declared examples that do not. */
  failing: PreviewRow[];
}

/** A neutral language guess for a text nothing has labelled: Kurdish-only letters mean Sorani, other Arabic script Arabic, Latin English. */
export function guessLanguage(text: string): Lang {
  const s = scriptsOf(text);
  if (s.arabic) return s.kurdishLetters ? "ckb" : "ar";
  return s.latin ? "en" : "ckb";
}

function assumedLabel(text: string): Classification {
  return { type: "OTHER", intent: "none", language: guessLanguage(text), confidence: 0.9 };
}

function labelFor(spec: RuleSpecT, text: string, as: Partial<Classification> | undefined, classify: Classifier): { c: Classification | null; source: LabelSource } {
  const base = classify(text);
  if (as && Object.keys(as).length) return { c: { ...(base ?? assumedLabel(text)), ...as }, source: "declared" };
  if (base) return { c: base, source: "classifier" };
  return needsLabel(spec.trigger) ? { c: null, source: "none" } : { c: assumedLabel(text), source: "assumed" };
}

function pseudoRule(spec: RuleSpecT): RuleRecord {
  return { id: "preview", version: 0, priority: 100, createdAt: new Date(0), spec };
}

function pickInput(spec: RuleSpecT, text: string, c: Classification | null, ctx: PreviewContext): PickInput {
  return {
    channel: spec.trigger.channel,
    platform: spec.trigger.platforms[0],
    text,
    viaVoice: ctx.viaVoice ?? false,
    c,
    canPrivateReply: ctx.canPrivateReply ?? true,
    privateReplyUsed: false,
    limited: false,
    hasProductCard: ctx.hasProductCard ?? false,
    orderInProgress: false,
    usage: {},
    senderRepliesLastHour: 0,
  };
}

function row(spec: RuleSpecT, text: string, as: Partial<Classification> | undefined, expected: boolean | null, declared: boolean, classify: Classifier, ctx: PreviewContext): PreviewRow {
  const { c, source } = labelFor(spec, text, as, classify);
  const r = pickRule(pickInput(spec, text, c, ctx), [pseudoRule(spec)]);
  const t = r.trace[0];
  const matches = t.outcome === "fired" || t.outcome === "waiting";
  return {
    text,
    declared,
    expected,
    triggered: t.outcome !== "no_match",
    matches,
    ok: expected === null ? null : expected === matches,
    label: c,
    labelSource: source,
    sends: r.reply ? { text: r.reply.text, textLang: r.reply.textLang, lang: r.reply.lang, channel: r.reply.channel, publicLine: r.reply.publicLine } : null,
    flags: r.flag,
    pauses: r.pause,
    waits: r.waiting.length > 0,
    reasons: t.reasons,
  };
}

/**
 * Run the rule's declared examples and any extra samples through the real matcher and engine. The rule is judged on its own
 * channel and its first platform, with nothing in the way (no limit reached, no window closed) unless `ctx` says so.
 */
export function previewRule(spec: RuleSpecT, samples: readonly (string | PreviewSample)[] = [], classify: Classifier = classifyByRules, ctx: PreviewContext = {}): PreviewResult {
  const rows: PreviewRow[] = [
    ...spec.examples.map((e) => row(spec, e.text, e.as, e.match, true, classify, ctx)),
    ...samples.map((s) => {
      const sample = typeof s === "string" ? { text: s } : s;
      return row(spec, sample.text, sample.as, null, false, classify, ctx);
    }),
  ];
  const failing = rows.filter((r) => r.declared && r.ok === false);
  return { rows, examplesOk: failing.length === 0, failing };
}

/** Just the declared examples: the check that is re-run on every save. */
export function evaluateExamples(spec: RuleSpecT, classify: Classifier = classifyByRules): PreviewResult {
  return previewRule(spec, [], classify);
}

// ---------------------------------------------------------------------------------------------------------------------
// Backtest on messages the shop already has.

/** A stored buyer message with the labels the pipeline saved on it (ConversationMessage.commentType, intent, language, confidence). */
export interface StoredMessage {
  id: string;
  text: string;
  channel?: RuleChannel;
  platform?: RulePlatform;
  viaVoice?: boolean;
  type?: string | null;
  intent?: string | null;
  language?: string | null;
  confidence?: number | null;
}

export interface BacktestResult {
  /** Messages given. */
  total: number;
  /** Of the rule's channel and platforms and with a label (stored, or given by the free classifier): the ones it was judged on. */
  considered: number;
  /**
   * Messages of the rule's channel and platforms that could not be judged: nothing stored a label on them, the free classifier cannot
   * label them, and the rule depends on labels. They are not counted as "the rule would not act": they are left out.
   */
  unjudged: number;
  /** The trigger matched. */
  triggered: number;
  /** The rule would have acted. */
  matched: number;
  /** matched / considered. */
  share: number;
  /** A few messages it would have acted on. These are BUYERS' words: for the person's screen only, never for the model. */
  examples: { id: string; text: string }[];
  /** For the messages it did not act on, how often each reason was the first. */
  byReason: Partial<Record<ReasonCode, number>>;
}

function storedLabel(m: StoredMessage): Classification | null {
  if (!COMMENT_TYPES.includes(m.type as CommentType)) return null;
  const intent = (m.intent ?? "none") as Intent;
  if (!INTENTS.includes(intent)) return null;
  if (!LANGS.includes(m.language as Lang)) return null;
  const confidence = typeof m.confidence === "number" && Number.isFinite(m.confidence) ? m.confidence : null;
  if (confidence === null) return null;
  return { type: m.type as CommentType, intent, language: m.language as Lang, confidence };
}

/**
 * How many of the shop's stored messages the rule would have acted on, from the labels already stored (no model call).
 * A message nothing has labelled yet (a shop whose automatic replies were off, a post beyond its slots) is labelled with the free
 * classifier, as a preview does; when that cannot label it either, the rule is judged on it only if it does not depend on labels,
 * otherwise the message is left out (`unjudged`), never counted as "the rule would not act". `maxExamples` messages are returned.
 */
export function backtestRule(
  spec: RuleSpecT,
  messages: readonly StoredMessage[],
  opts: { maxExamples?: number; ctx?: PreviewContext; classify?: Classifier } = {},
): BacktestResult {
  const max = opts.maxExamples ?? 5;
  const classify = opts.classify ?? classifyByRules;
  const rule = pseudoRule(spec);
  const out: BacktestResult = { total: messages.length, considered: 0, unjudged: 0, triggered: 0, matched: 0, share: 0, examples: [], byReason: {} };
  for (const m of messages) {
    if (m.channel && m.channel !== spec.trigger.channel) continue;
    if (m.platform && !spec.trigger.platforms.includes(m.platform)) continue;
    const label = storedLabel(m) ?? labelFor(spec, m.text, undefined, classify).c;
    if (!label) {
      out.unjudged++;
      continue;
    }
    out.considered++;
    const input = pickInput(spec, m.text, label, { ...opts.ctx, viaVoice: m.viaVoice ?? opts.ctx?.viaVoice ?? false });
    if (m.platform) input.platform = m.platform;
    const t = pickRule(input, [rule]).trace[0];
    if (t.outcome !== "no_match") out.triggered++;
    if (t.outcome === "fired" || t.outcome === "waiting") {
      out.matched++;
      if (out.examples.length < max) out.examples.push({ id: m.id, text: m.text });
    } else if (t.reasons[0]) {
      out.byReason[t.reasons[0]] = (out.byReason[t.reasons[0]] ?? 0) + 1;
    }
  }
  out.share = out.considered ? out.matched / out.considered : 0;
  return out;
}

/** The lint finding a backtest earns: a warning above 30 % of the stored messages, a problem above 60 %; nothing on a small sample. */
export function backtestIssue(b: BacktestResult): LintIssue | null {
  if (b.considered < BACKTEST_MIN_SAMPLE) return null;
  const share = Math.round(b.share * 100);
  if (b.share > BACKTEST_REFUSE) return { code: "backtest_too_broad", level: "problem", params: { share } };
  if (b.share > BACKTEST_WARN) return { code: "backtest_broad", level: "warning", params: { share } };
  return null;
}
