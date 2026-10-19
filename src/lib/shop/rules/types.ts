// Shared vocabulary of the owner rules ("automations in plain words"): the closed lists the rule language is built from, the
// limits, the reason codes of the log and the shape of a lint finding. Constants and types only; nothing here runs anything.

import type { Lang as UiLang } from "@/lib/i18n/lang";
import type { Lang } from "../money";
import type { CommentType, Intent } from "../policy";

export type { UiLang, Lang };

/** A sentence in the person's three languages (the screen speaks Sorani, Arabic and English). */
export type Tri = Record<UiLang, string>;

export const PLATFORMS = ["META_FACEBOOK", "META_INSTAGRAM", "WHATSAPP"] as const;
export type RulePlatform = (typeof PLATFORMS)[number];

export const CHANNELS = ["comment", "dm"] as const;
export type RuleChannel = (typeof CHANNELS)[number];

export const KEYWORD_MODES = ["word", "prefix", "contains"] as const;
export type KeywordMode = (typeof KEYWORD_MODES)[number];

/** The languages the classifier labels a message with (src/lib/shop/money.ts). */
export const SHOP_LANGS = ["ckb", "kmr", "ar", "ku_latn", "en"] as const satisfies readonly Lang[];

/** The topics a trigger may name. "none" is not selectable: it is what a message with no topic is labelled. */
export const RULE_INTENTS = ["price", "delivery", "size_colour", "address", "hours", "availability"] as const satisfies readonly Intent[];

/**
 * The kinds of message a trigger may name. COMPLAINT, ABUSE and SPAM are deliberately absent: they stay with the owner
 * and are never answered by a rule, whatever words they contain.
 */
export const RULE_TYPES = ["QUESTION", "ORDER", "NEGOTIATION", "PRAISE", "OTHER"] as const satisfies readonly CommentType[];

/** Every label the classifier can give, for an example that wants to say "this one is a complaint". */
export const ALL_TYPES = ["QUESTION", "ORDER", "PRAISE", "NEGOTIATION", "COMPLAINT", "ABUSE", "SPAM", "OTHER"] as const satisfies readonly CommentType[];
export const ALL_INTENTS = ["price", "delivery", "size_colour", "address", "hours", "availability", "none"] as const satisfies readonly Intent[];

/** Kinds of message a rule never answers with words. */
export const NEVER_ANSWERED: readonly CommentType[] = ["COMPLAINT", "ABUSE", "SPAM"];

export const ACTION_KINDS = ["reply", "flag_owner", "pause_thread"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Longest text the owner may set as a fixed reply, in characters (not UTF-16 units). */
export const MAX_TEXT = 900;
/**
 * Longest message Instagram accepts, in UTF-8 BYTES, not characters. A Sorani or Arabic letter is 2 bytes, so 900 characters of
 * Sorani can be about 1,700 bytes. A rule that can run on Instagram refuses any reply text over this; the others only get a warning.
 */
export const MAX_TEXT_BYTES = 1000;
/** How many rules in one shop may be ACTIVE at once. */
export const MAX_ACTIVE_RULES = 10;
/** A hidden ceiling per sender: rule replies to one person in an hour, over all rules. A bot on the other side is stopped here. */
export const MAX_SENDER_REPLIES_PER_HOUR = 3;
/** A keyword shorter than this (in letters of its folded skeleton) is too broad to be a trigger on its own. */
export const MIN_KEYWORD_LETTERS = 3;
/** Share of the last stored messages a rule hits: above the first it is a warning, above the second the rule is refused. */
export const BACKTEST_WARN = 0.3;
export const BACKTEST_REFUSE = 0.6;
/** A backtest on fewer messages than this says nothing. */
export const BACKTEST_MIN_SAMPLE = 10;

/** Why a rule's trigger did not match this message. */
export const NO_MATCH_REASONS = [
  "wrong_channel", "wrong_platform", "voice", "no_keyword", "blocked_word", "no_label", "wrong_intent", "wrong_type", "wrong_language",
] as const;
export type NoMatchReason = (typeof NO_MATCH_REASONS)[number];

/** Why a rule whose trigger matched did not act (all of it, or only its reply). */
export const SKIP_REASONS = [
  "order_in_progress", "cap_rule_day", "cap_person", "cap_sender_hour", "reply_needs_label", "never_answered", "order_flow",
  "low_confidence", "limited", "private_window", "private_reply_used", "product_card", "reply_taken", "pause_needs_reply", "opt_out",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type ReasonCode = NoMatchReason | SkipReason;

export type LintLevel = "problem" | "warning";

export const LINT_CODES = [
  "trigger_empty", "keyword_contradiction", "intent_type_conflict", "platform_channel", "keyword_short", "keyword_common",
  "self_trigger", "too_many_rules", "duplicate", "examples_fail", "reply_on_order", "backtest_too_broad",
  "keyword_contains_short", "overlap", "same_text", "text_link", "text_phone", "text_price", "card_replaced",
  "language_script_mismatch", "single_language_text", "pause_is_lasting", "backtest_broad", "text_long_bytes",
] as const;
export type LintCode = (typeof LINT_CODES)[number];

/** One finding of the lint. The words come from render.ts (lintText) so that every language has them. */
export interface LintIssue {
  code: LintCode;
  level: LintLevel;
  /** The values the sentence needs ("word", "other", "share"…). Owner-written text only, never a buyer's. */
  params?: Record<string, string | number>;
}
