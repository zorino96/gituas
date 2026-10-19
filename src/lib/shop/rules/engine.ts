// pickRule: which of the shop's ACTIVE rules act on this message, and what they do. Pure: everything it needs about the world
// (the classifier's label, the pipeline's facts, today's counters) is passed in, and it returns both the decision and the reason
// every rule did or did not act, so the log (RuleRun) can say why without anyone re-running anything.
//
// What a rule can never do, whatever its owner wrote:
//   - answer a message the classifier could not label, or labelled COMPLAINT, ABUSE or SPAM, or ORDER (Gituas collects orders itself);
//   - interrupt an order that is being collected, or answer a voice note;
//   - answer twice: ONE reply per message, however many rules match;
//   - reply where Meta does not allow it (the private-reply window, one private reply per comment);
//   - exceed its own daily limits, or send one person more than a few rule replies in an hour.
// A reply always goes to the author of the triggering message: the recipient is not a parameter anywhere.

import type { Classification } from "../policy";
import { MIN_CONFIDENCE } from "../policy";
import { conditionCount, matchTrigger, needsLabel, prepareText } from "./match";
import type { RuleSpecT, RuleTexts } from "./spec";
import { actionsOf } from "./spec";
import {
  MAX_SENDER_REPLIES_PER_HOUR, NEVER_ANSWERED,
  type ActionKind, type Lang, type ReasonCode, type RuleChannel, type RulePlatform,
} from "./types";

/** An ACTIVE rule as the engine sees it. */
export interface RuleRecord {
  id: string;
  version: number;
  /** Higher goes first. */
  priority: number;
  createdAt: Date;
  spec: RuleSpecT;
}

/** How often a rule has already acted: today (Baghdad day) in all, and for the sender of this message. */
export interface RuleUsage {
  today: number;
  personToday: number;
}

export interface PickInput {
  channel: RuleChannel;
  platform: RulePlatform;
  /** What the buyer typed (typedText for a DM). */
  text: string;
  /** The text is a voice note's transcript. */
  viaVoice: boolean;
  /** The classifier's label; null when there is none. */
  c: Classification | null;
  /** Comments: the comment is younger than Meta's 7-day private-reply window. Ignored for DMs. */
  canPrivateReply: boolean;
  /** Comments: a private reply to this comment already exists (Meta allows one). Ignored for DMs. */
  privateReplyUsed: boolean;
  /** This author was already answered on this post today (the pipeline's author_limit). */
  limited: boolean;
  /**
   * The pipeline's own answer to this message is a product card (comment: the planned private reply is the card; DM: the planned
   * action is a card answer). Not merely "a product is bound": a DM about the shop's address has a bound product but no card
   * answer, and a rule may well answer it. A rule whose productCard is "keep" stays silent then; "replace" sends its text instead.
   */
  hasProductCard: boolean;
  /** The buyer is in the middle of giving their order details. */
  orderInProgress: boolean;
  /** By rule id. A rule missing here has not acted yet. */
  usage: Readonly<Record<string, RuleUsage | undefined>>;
  /** Rule replies already sent to this sender in the last hour, over all rules. */
  senderRepliesLastHour: number;
}

export interface RuleReply {
  ruleId: string;
  ruleVersion: number;
  matched: string;
  /** private: the private reply to a comment; dm: the answer in the chat. */
  channel: "private" | "dm";
  text: string;
  /** The buyer's language as labelled. */
  lang: Lang;
  /** The language the chosen text is written for ("default" when the rule had no text for the buyer's language). */
  textLang: Lang | "default";
  /** Comments: keep the standard public line ("we sent you a message") with the private reply. */
  publicLine: "standard" | "none";
}

export interface Fired {
  ruleId: string;
  ruleVersion: number;
  matched: string;
  did: ActionKind[];
}

/** A rule whose trigger matched and whose action waits for a timer (the sweep acts, or not, when it is due). */
export interface Waiting {
  ruleId: string;
  ruleVersion: number;
  matched: string;
  minutes: number;
}

export type TraceOutcome = "fired" | "waiting" | "skipped" | "no_match";
/** One line of the log: what happened with this rule on this message and why. */
export interface RuleTrace {
  ruleId: string;
  ruleVersion: number;
  name: string;
  outcome: TraceOutcome;
  /** The owner's keyword (or "intent:price") that matched; null when the trigger did not. */
  matched: string | null;
  did: ActionKind[];
  /** Why not: for no_match the first thing that was wrong; for skipped what stopped it; for fired what stopped part of it. */
  reasons: ReasonCode[];
}

export interface PickResult {
  reply: RuleReply | null;
  /** At least one rule that acted wants the message on the owner's "needs you" pile. */
  flag: boolean;
  /** The notes of those rules, deduplicated. */
  flagNotes: string[];
  pause: boolean;
  fired: Fired[];
  waiting: Waiting[];
  /** Every rule looked at, in selection order. */
  trace: RuleTrace[];
}

/** Priority (higher first), then the more specific rule (more conditions), then the older rule, then the id. */
export function orderRules(rules: readonly RuleRecord[]): RuleRecord[] {
  return [...rules].sort(
    (a, b) =>
      b.priority - a.priority ||
      conditionCount(b.spec.trigger) - conditionCount(a.spec.trigger) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * The text for a buyer's language: their own language's text, else (Badini) the Sorani text, else the rule's default.
 * A Latin-script Kurdish reader is not given the Arabic-script text unless it is the default.
 */
export function pickText(texts: RuleTexts, lang: Lang | null | undefined): { text: string; textLang: Lang | "default" } {
  if (lang) {
    const own = texts[lang];
    if (own) return { text: own, textLang: lang };
    if (lang === "kmr" && texts.ckb) return { text: texts.ckb, textLang: "ckb" };
  }
  return { text: texts.default, textLang: "default" };
}

/** The first thing that forbids a rule to answer this message in words, or null. */
function replyBlock(rule: RuleRecord, input: PickInput): ReasonCode | null {
  const c = input.c;
  if (!c) return "reply_needs_label";
  if (NEVER_ANSWERED.includes(c.type)) return "never_answered";
  // Orders are Gituas's own job (it opens the order and asks for the details); a canned text would take the place of that.
  if (c.type === "ORDER") return "order_flow";
  // A trigger that rests on the label is only as good as the label.
  if (needsLabel(rule.spec.trigger) && c.confidence < MIN_CONFIDENCE) return "low_confidence";
  if (input.limited) return "limited";
  if (input.channel === "comment") {
    if (!input.canPrivateReply) return "private_window";
    if (input.privateReplyUsed) return "private_reply_used";
  }
  if (input.hasProductCard && rule.spec.trigger.productCard === "keep") return "product_card";
  if (input.senderRepliesLastHour >= MAX_SENDER_REPLIES_PER_HOUR) return "cap_sender_hour";
  return null;
}

export function pickRule(input: PickInput, rules: readonly RuleRecord[]): PickResult {
  const result: PickResult = { reply: null, flag: false, flagNotes: [], pause: false, fired: [], waiting: [], trace: [] };
  const text = prepareText(input.text);
  const notes = new Set<string>();

  for (const rule of orderRules(rules)) {
    const { spec } = rule;
    const line = (outcome: TraceOutcome, matched: string | null, did: ActionKind[], reasons: ReasonCode[]): void => {
      result.trace.push({ ruleId: rule.id, ruleVersion: rule.version, name: spec.name, outcome, matched, did, reasons });
    };

    const m = matchTrigger(spec.trigger, { channel: input.channel, platform: input.platform, text, viaVoice: input.viaVoice, c: input.c });
    if (!m.ok) {
      line("no_match", null, [], [m.reason]);
      continue;
    }
    if (input.orderInProgress) {
      line("skipped", m.matched, [], ["order_in_progress"]);
      continue;
    }
    const used = input.usage[rule.id] ?? { today: 0, personToday: 0 };
    if (used.today >= spec.limits.perDay) {
      line("skipped", m.matched, [], ["cap_rule_day"]);
      continue;
    }
    if (used.personToday >= spec.limits.perPersonPerDay) {
      line("skipped", m.matched, [], ["cap_person"]);
      continue;
    }
    if (spec.wait) {
      result.waiting.push({ ruleId: rule.id, ruleVersion: rule.version, matched: m.matched, minutes: spec.wait.unansweredMinutes });
      line("waiting", m.matched, [], []);
      continue;
    }

    const { reply, flag, pause } = actionsOf(spec);
    const did: ActionKind[] = [];
    const reasons: ReasonCode[] = [];

    if (reply) {
      const block = replyBlock(rule, input);
      if (block) reasons.push(block);
      else if (result.reply) reasons.push("reply_taken");
      else {
        const chosen = pickText(reply.texts, input.c?.language);
        result.reply = {
          ruleId: rule.id,
          ruleVersion: rule.version,
          matched: m.matched,
          channel: input.channel === "comment" ? "private" : "dm",
          text: chosen.text,
          lang: input.c?.language ?? "ckb",
          textLang: chosen.textLang,
          publicLine: input.channel === "comment" ? reply.publicLine : "none",
        };
        did.push("reply");
      }
    }
    if (flag) {
      did.push("flag_owner");
      result.flag = true;
      if (flag.note) notes.add(flag.note);
    }
    if (pause) {
      // A pause that comes with a reply means "say this, then stop": without the reply it would only silence the thread.
      if (reply && !did.includes("reply")) reasons.push("pause_needs_reply");
      else {
        did.push("pause_thread");
        result.pause = true;
      }
    }

    if (did.length) {
      result.fired.push({ ruleId: rule.id, ruleVersion: rule.version, matched: m.matched, did });
      line("fired", m.matched, did, reasons);
    } else {
      line("skipped", m.matched, [], reasons);
    }
  }
  result.flagNotes = [...notes];
  return result;
}
