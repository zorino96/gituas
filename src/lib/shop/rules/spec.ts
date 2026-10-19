// RuleSpec v1: the one shape an owner rule can have. The model only ever proposes JSON for this schema; the server validates it
// strictly (unknown keys are errors), so there is no way to ask for a recipient, a time of sending or a bulk send: a reply always
// goes to the person whose message triggered it, once, now. The texts are the OWNER's own fixed words: nothing here is written by
// a model at run time.

import { createHash } from "node:crypto";
import { z } from "zod";
import { classifyByRules } from "../classify-rules";
import { fold } from "./fold";
import {
  ALL_INTENTS, ALL_TYPES, KEYWORD_MODES, MAX_TEXT, PLATFORMS, RULE_INTENTS, RULE_TYPES, SHOP_LANGS,
  type RulePlatform, type ActionKind,
} from "./types";

/** Characters that have no business in text a buyer will read or a person will approve: controls, bidi overrides, zero-width space. */
const HIDDEN_OR_CONTROL = /[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{7F}-\u{9F}\u{AD}\u{200B}\u{2028}\u{2029}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/u;

/** Length in characters as a person counts them (an emoji is one), not in UTF-16 units. */
const chars = (s: string): number => Array.from(s).length;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "must not be empty")
    .refine((s) => chars(s) <= max, { message: `must be at most ${max} characters` })
    .refine((s) => !HIDDEN_OR_CONTROL.test(s), { message: "must not contain hidden or control characters" });

const keyword = text(40)
  .refine((s) => !/[\r\n]/.test(s), { message: "a keyword is one line" })
  .refine((s) => fold(s) !== "", { message: "needs a letter, a number or an emoji" });

const variant = text(MAX_TEXT).optional().describe("Optional text for buyers who write in this language. At most 900 characters.");

const Texts = z
  .object({
    /** Used when the buyer's language has no text of its own. */
    default: text(MAX_TEXT).describe("The owner's own fixed words, used when there is no text for the buyer's language. At most 900 characters."),
    ckb: variant,
    kmr: variant,
    ar: variant,
    ku_latn: variant,
    en: variant,
  })
  .strict();

const Keywords = z
  .object({
    any: z.array(keyword).min(1).max(30).describe("Words that trigger the rule (1 to 30, each at most 40 characters). Write every spelling a buyer may use: Sorani, Badini, Arabic and Latin letters."),
    none: z.array(keyword).max(20).default([]).describe("Words that stop the rule even when one of the above is there."),
    /** word: whole words; prefix: words that start with it (Kurdish glues endings on); contains: anywhere in the text. */
    mode: z.enum(KEYWORD_MODES).default("prefix").describe("word: whole words only. prefix (default): a word may continue after the keyword, as Kurdish glues endings on. contains: anywhere in the text."),
  })
  .strict();

const Trigger = z
  .object({
    channel: z.enum(["comment", "dm"]),
    platforms: z.array(z.enum(PLATFORMS)).min(1).max(3),
    keywords: Keywords.optional(),
    intents: z.array(z.enum(RULE_INTENTS)).min(1).max(6).optional(),
    types: z.array(z.enum(RULE_TYPES)).min(1).max(5).optional(),
    languages: z.array(z.enum(SHOP_LANGS)).min(1).max(5).optional(),
    /** Voice notes count too. Off by default: a transcript can be mis-heard, so it never triggers a reply. */
    viaVoice: z.boolean().default(false).describe("Voice notes count too. A rule that replies can never take voice notes."),
    /** keep: on a thread that already has a product card the rule does not reply (the card answers). replace: the rule's text goes instead. */
    productCard: z.enum(["keep", "replace"]).default("keep").describe("keep (default): where Gituas answers with the product card, the rule stays silent. replace: the rule's text is sent instead of the card."),
  })
  .strict()
  .refine((t) => !!(t.keywords || t.intents || t.types), { message: "needs keywords, intents or types", path: ["keywords"] });

const Action = z.discriminatedUnion("do", [
  z.object({ do: z.literal("reply"), texts: Texts, publicLine: z.enum(["standard", "none"]).default("standard").describe("Comments only: standard adds the usual short public comment saying a message was sent.") }).strict(),
  z.object({ do: z.literal("flag_owner"), note: text(200).optional().describe("Shown next to the message on the owner's Needs you list.") }).strict(),
  z.object({ do: z.literal("pause_thread") }).strict(),
]);

const Example = z
  .object({
    text: text(200),
    /** Whether the rule should act on this text. */
    match: z.boolean().describe("true if the rule should act on this text, false if it must not."),
    /** The label to assume for this text; what classifyByRules gives is used for the rest. */
    as: z
      .object({
        type: z.enum(ALL_TYPES),
        intent: z.enum(ALL_INTENTS),
        language: z.enum(SHOP_LANGS),
        confidence: z.number().min(0).max(1),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export const RuleSpec = z
  .object({
    v: z.literal(1),
    name: text(80).describe("A short name for the owner's list."),
    trigger: Trigger,
    /** Act only if nobody has answered after this many minutes (flag_owner only). Handled by the timer sweep. */
    wait: z.object({ unansweredMinutes: z.number().int().min(2).max(720) }).strict().optional(),
    actions: z.array(Action).min(1).max(3),
    limits: z
      .object({
        perPersonPerDay: z.number().int().min(1).max(3).default(1),
        perDay: z.number().int().min(1).max(200).default(50),
      })
      .strict()
      .default({ perPersonPerDay: 1, perDay: 50 }),
    /** Texts that should and should not trigger the rule. They are run again on every save and every edit. */
    examples: z.array(Example).min(2).max(12),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const kinds = spec.actions.map((a) => a.do);
    for (const k of new Set(kinds)) if (kinds.filter((x) => x === k).length > 1) add(["actions"], `"${k}" is there more than once`);
    const hasReply = kinds.includes("reply");

    if (spec.wait) {
      if (hasReply) add(["wait"], "a reply cannot wait: it is sent now, while the person is still there");
      if (!kinds.includes("flag_owner")) add(["wait"], "a wait needs a flag_owner action: it is a reminder for the owner");
      if (kinds.includes("pause_thread")) add(["wait"], "pause_thread cannot wait");
    }
    if (spec.trigger.channel === "comment" && spec.trigger.platforms.includes("WHATSAPP")) {
      add(["trigger", "platforms"], "WhatsApp has no comments: use channel dm");
    }
    if (hasReply && spec.trigger.viaVoice) add(["trigger", "viaVoice"], "a reply is never sent to a voice note: speech recognition can mishear");

    if (!spec.examples.some((e) => e.match)) add(["examples"], "needs at least one example that should match");
    if (!spec.examples.some((e) => !e.match)) add(["examples"], "needs at least one example that should NOT match");
    // A trigger that reads the classifier's labels can only be checked offline for a text the free classifier can label, or one
    // that says which label to assume.
    if (spec.trigger.intents || spec.trigger.types || spec.trigger.languages) {
      spec.examples.forEach((e, i) => {
        if (e.match && !e.as && !classifyByRules(e.text)) add(["examples", i, "as"], 'this rule reads the message type, topic or language: say which label to assume for this example ("as")');
      });
    }
  });

export type RuleSpecT = z.output<typeof RuleSpec>;
export type RuleSpecInput = z.input<typeof RuleSpec>;
export type RuleTrigger = RuleSpecT["trigger"];
export type RuleAction = RuleSpecT["actions"][number];
export type ReplyAction = Extract<RuleAction, { do: "reply" }>;
export type FlagAction = Extract<RuleAction, { do: "flag_owner" }>;
export type RuleTexts = ReplyAction["texts"];
export type RuleExample = RuleSpecT["examples"][number];

/** The three actions a rule can have, found by kind. */
export function actionsOf(spec: RuleSpecT): { reply: ReplyAction | null; flag: FlagAction | null; pause: boolean } {
  return {
    reply: (spec.actions.find((a) => a.do === "reply") as ReplyAction | undefined) ?? null,
    flag: (spec.actions.find((a) => a.do === "flag_owner") as FlagAction | undefined) ?? null,
    pause: spec.actions.some((a) => a.do === "pause_thread"),
  };
}

export type ParseResult = { ok: true; spec: RuleSpecT } | { ok: false; issues: string[] };

/** "trigger.keywords.any.0: must not be empty": one line per problem, for a model that has to correct its JSON. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(rule)"}: ${i.message}`);
}

/** Validate unknown input and return the canonical (normalised) rule, or a list of what is wrong with it. */
export function parseRuleSpec(input: unknown): ParseResult {
  const r = RuleSpec.safeParse(input);
  return r.success ? { ok: true, spec: normalise(r.data) } : { ok: false, issues: describeIssues(r.error) };
}

// ---------------------------------------------------------------------------------------------------------------------
// The canonical form. Two rules that mean the same thing have the same bytes, so the hash can tell "changed" from "re-saved".

const ordered = <T extends string>(all: readonly T[], some: readonly T[]): T[] => all.filter((x) => some.includes(x));

/** Keywords deduplicated by their folded form (the first spelling wins) and sorted by it. */
function canonicalKeywords(list: readonly string[]): string[] {
  const byFold = new Map<string, string>();
  for (const k of list) {
    const key = fold(k);
    if (key && !byFold.has(key)) byFold.set(key, k.trim());
  }
  return [...byFold.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
}

/** A text as it is stored: NFC, Unix line ends, no trailing spaces, no run of blank lines. */
function canonicalText(s: string): string {
  return s
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const oneLine = (s: string): string => s.normalize("NFC").replace(/\s+/g, " ").trim();

/** The canonical form of a (valid) spec: sets sorted and deduplicated, texts tidied, texts equal to the default dropped. */
export function normalise(spec: RuleSpecT): RuleSpecT {
  const t = spec.trigger;
  const trigger: RuleTrigger = {
    channel: t.channel,
    platforms: ordered(PLATFORMS, t.platforms),
    viaVoice: t.viaVoice,
    productCard: t.productCard,
  };
  if (t.keywords) trigger.keywords = { any: canonicalKeywords(t.keywords.any), none: canonicalKeywords(t.keywords.none), mode: t.keywords.mode };
  if (t.intents) trigger.intents = ordered(RULE_INTENTS, t.intents);
  if (t.types) trigger.types = ordered(RULE_TYPES, t.types);
  if (t.languages) trigger.languages = ordered(SHOP_LANGS, t.languages);

  const order: ActionKind[] = ["reply", "flag_owner", "pause_thread"];
  const actions = [...spec.actions]
    .sort((a, b) => order.indexOf(a.do) - order.indexOf(b.do))
    .map((a): RuleAction => {
      if (a.do === "reply") {
        const def = canonicalText(a.texts.default);
        const texts: RuleTexts = { default: def };
        for (const lang of SHOP_LANGS) {
          const v = a.texts[lang];
          const c = v === undefined ? "" : canonicalText(v);
          if (c && c !== def) texts[lang] = c;
        }
        // A private message has no public line to speak of: keep the canonical form single.
        return { do: "reply", texts, publicLine: t.channel === "dm" ? "none" : a.publicLine };
      }
      if (a.do === "flag_owner") {
        const note = a.note === undefined ? "" : oneLine(a.note);
        return note ? { do: "flag_owner", note } : { do: "flag_owner" };
      }
      return { do: "pause_thread" };
    });

  const out: RuleSpecT = {
    v: 1,
    name: oneLine(spec.name),
    trigger,
    actions,
    limits: { perPersonPerDay: spec.limits.perPersonPerDay, perDay: spec.limits.perDay },
    examples: spec.examples.map((e) => {
      const ex: RuleExample = { text: oneLine(e.text), match: e.match };
      if (e.as && Object.keys(e.as).length) ex.as = { ...e.as };
      return ex;
    }),
  };
  if (spec.wait) out.wait = { unansweredMinutes: spec.wait.unansweredMinutes };
  return out;
}
/** American spelling, for callers that use it. */
export const normalize = normalise;

/** JSON with every object's keys sorted and undefined left out: the same value always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, walk(x)]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

/** sha256 (hex) of the canonical JSON of the normalised spec. Re-saving the same rule gives the same hash. */
export function specHash(spec: RuleSpecT): string {
  return createHash("sha256").update(canonicalJson(normalise(spec))).digest("hex");
}

/** Platforms a trigger can run on for its channel: WhatsApp has no comments. */
export function platformsFor(channel: "comment" | "dm"): readonly RulePlatform[] {
  return channel === "comment" ? PLATFORMS.filter((p) => p !== "WHATSAPP") : PLATFORMS;
}
