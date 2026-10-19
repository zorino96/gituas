// The write tools of the owner rules: create, pause, switch back on, delete. A rule acts later, on its own, in the owner's name, so
// creating or resuming one is "standing" (always a card, whatever the autonomy setting), deleting is "destructive" (always a card),
// and pausing is "low" (it only makes the shop quieter).
//
// The model writes the rule as JSON for the strict RuleSpec schema; the server checks it, lints it against the shop's other rules,
// runs its examples through the real matcher and shows the PERSON the rule in words, with every text it will send. What Confirm
// activates is exactly that: the card pins the checked rule and its hash into the stored arguments.
//
// In this version a rule replies (the owner's fixed text, to the person who wrote) and flags the message for the owner. It cannot
// wait for a timer or pause a conversation: those specs are refused here.

import { z } from "zod";

import { defineWrite, ToolRefusal, type Card, type CardLine, type ToolCtx, type WriteResult, type WriteTool } from "../types";
import { countStored, findStoredRule, insertRule, MAX_STORED_RULES, setRuleStatus, storeSwitches, type StoredRule } from "@/lib/shop/rules/db";
import { rulesDryRun, rulesEnabled } from "@/lib/shop/rules/enabled";
import { lintText, ruleParts, ruleSentence } from "@/lib/shop/rules/render";
import { actionsOf, parseRuleSpec, RuleSpec, specHash, type RuleSpecT } from "@/lib/shop/rules/spec";
import { assessRule, keepsProductCard, problemLines, ruleShopFor, unsupported, type Assessment } from "./reads-rules";
import { clip, refuse } from "./writes-common";
import { DONE, EXAMPLE, FIELD, LABEL, NOTE, quoted, TITLE, VIEW } from "./rules-words";
import { NEW } from "./writes-words";

/** How many of a rule's examples the card lists (a rule may carry twelve). */
const EXAMPLE_LINES_MAX = 8;
const BACKTEST_DAYS = 14;

const RULES_OFF = "Automatic rules are not switched on for this account yet, so none can be created or changed. Tell the person it is not available yet.";
const requireOn = (): void => {
  if (!rulesEnabled()) refuse(RULES_OFF);
};

/** The rule as the server will store it: checked, normalised, and without the features this version does not run. */
function usable(input: unknown): RuleSpecT {
  const parsed = parseRuleSpec(input);
  if (!parsed.ok) return refuse(`The rule is not valid: ${parsed.issues.join("; ")}`);
  const notYet = unsupported(parsed.spec);
  if (notYet.length) return refuse(notYet.join(" "));
  return parsed.spec;
}

const createSchema = z
  .object({
    spec: RuleSpec,
    shop: z.string().trim().min(1).max(120).optional().describe("Only when the account has several shops: the shop's name or @handle, as the person says it (ask which). Once the card is made it holds the shop's id."),
    specHash: z.string().regex(/^[0-9a-f]{64}$/).optional().describe("Never set this: it is filled in when the card is made."),
  })
  .strict();
const ruleArg = z.object({ rule: z.string().trim().min(1).max(120).describe("The rule's id exactly as list_rules gives it, or its exact name") }).strict();

/** The rule a name or id points at, inside this workspace, or a refusal the model can act on. */
async function ruleOf(ctx: ToolCtx, hint: string): Promise<StoredRule> {
  const found = await findStoredRule(ctx.tenantId, hint);
  if (!found.ok) {
    return refuse(found.why === "ambiguous" ? "More than one rule has that name. Call list_rules and pass the rule's id." : "No rule of this account matches that. Call list_rules and pass the rule's id.");
  }
  return found.rule;
}

/** A run that finds things changed since the card (the rule is gone, a limit was reached) says so in the person's language. */
async function guarded(ctx: ToolCtx, run: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolRefusal) return { ok: false, text: NEW.stale[ctx.lang] };
    throw e;
  }
}

const line = (label: string, value: string): CardLine => ({ label, value });
const TEXT_ORDER = ["default", "ckb", "kmr", "ar", "ku_latn", "en"] as const;

/** Every text the rule will send, each in its own line, full length: what the person approves is what buyers read. */
function textLines(spec: RuleSpecT, lang: ToolCtx["lang"]): CardLine[] {
  const reply = actionsOf(spec).reply;
  if (!reply) return [];
  const out: CardLine[] = [];
  for (const k of TEXT_ORDER) {
    const text = reply.texts[k];
    if (text) out.push(line(FIELD.text[k][lang], text));
  }
  if (out.length > 1) out.push(line(FIELD.note[lang], NOTE.textsRule[lang]));
  return out;
}

function exampleLines(a: Assessment, lang: ToolCtx["lang"]): CardLine[] {
  return a.preview.rows
    .filter((r) => r.declared)
    .slice(0, EXAMPLE_LINES_MAX)
    .map((r) => {
      const x = clip(r.text, 100);
      if (r.matches && r.sends) return line(FIELD.example[lang], EXAMPLE.sends[lang](x, clip(r.sends.text, 80)));
      if (r.matches) return line(FIELD.example[lang], EXAMPLE.flags[lang](x));
      return line(FIELD.example[lang], EXAMPLE.nothing[lang](x));
    });
}

/** What the shop's own switches say about whether this rule can act at all. */
function switchLines(switches: Awaited<ReturnType<typeof storeSwitches>>, lang: ToolCtx["lang"]): CardLine[] {
  return switches && (!switches.automatic || switches.pausedReason) ? [line(FIELD.warning[lang], NOTE.autoOff[lang])] : [];
}

function backtestLine(a: Assessment, lang: ToolCtx["lang"]): CardLine[] {
  const b = a.backtest;
  if (!b) return [];
  const unjudged = b.unjudged ? [line(FIELD.note[lang], NOTE.backtestUnjudged[lang](b.unjudged))] : [];
  if (b.considered < 10) return unjudged;
  return [line(FIELD.note[lang], NOTE.backtest[lang](b.considered, b.matched, Math.round(b.share * 100))), ...unjudged];
}

const create_rule = defineWrite({
  name: "create_rule",
  description:
    "Create an automatic rule for the shop and switch it on; the owner always confirms on a card first. spec is the whole rule: a trigger (channel comment or dm, platforms, the words to look for, and/or the kind or topic of the message), " +
    "the actions (reply with the owner's own fixed text, in one or more languages, and/or flag_owner), limits and examples. For the words, write every spelling a customer may use: Sorani, Badini, Arabic and Latin letters. " +
    "A rule only answers the person who wrote, once and at once, in the owner's own words. It cannot wait, pause a conversation, write first, write to many people, or answer orders, complaints, abuse or spam. " +
    "Never put a phone number, link or price in a text unless the owner gave it. Always call preview_rule first, show the owner what it found and fix the problems; examples must include texts that should match and texts that must not, and are written by you, never copied from a customer. " +
    "A text for a rule that can run on Instagram must be at most 1000 bytes (a Sorani or Arabic letter is 2 bytes: about 450 letters); never cut the owner's words, ask the owner to shorten them. " +
    "Where Gituas answers with the product card the rule stays silent by default (productCard keep); ask the owner whether to keep the card or send the rule's text instead (replace). " +
    "A message that asks us to stop writing never gets a rule's reply. If the account has several shops, ask which one and pass shop. " +
    "Do not set specHash.",
  schema: createSchema,
  kinds: ["shop"],
  permission: "configure",
  // The rule answers buyers by itself from then on, unwatched: always a card.
  risk: "standing",
  // The owner's own reply texts: a link, phone number or @handle the owner did not type is taken out before the card is made.
  textFields: ["spec.actions.*.texts.*", "spec.actions.*.note"],
  label: (lang) => LABEL.createRule[lang],
  async card(ctx, args): Promise<Card> {
    requireOn();
    const spec = usable(args.spec);
    // With several shops the person says which: never the first one by default.
    const shop = await ruleShopFor(ctx, args.shop);
    if ((await countStored(shop.store.id)) >= MAX_STORED_RULES) {
      refuse(`This shop already has ${MAX_STORED_RULES} rules. Ask the owner to delete one first (delete_rule).`);
    }
    const [a, switches] = await Promise.all([assessRule(shop.store.id, spec, { backtestDays: BACKTEST_DAYS }), storeSwitches(shop.store.id)]);
    if (!a.ok) refuse(`The rule cannot be created as written. ${problemLines(a.problems, a.preview).join(" ")} Fix the rule, call preview_rule again, then create_rule.`);

    const lang = ctx.lang;
    const note = actionsOf(spec).flag?.note;
    const lines: CardLine[] = [
      ...(shop.shopCount > 1 && shop.shopName ? [line(FIELD.shop[lang], shop.shopName)] : []),
      line(FIELD.name[lang], spec.name),
      line(FIELD.rule[lang], ruleSentence(spec, lang)),
      line(FIELD.limits[lang], ruleParts(spec, lang).limits),
      ...textLines(spec, lang),
      ...(note ? [line(FIELD.note[lang], quoted(note, lang))] : []),
      ...exampleLines(a, lang),
      // The examples above were run with no product card in the way; the owner must see what a card does to this rule before Confirm.
      ...(keepsProductCard(spec) ? [line(FIELD.warning[lang], NOTE.cardKept[lang])] : []),
      ...a.warnings.map((w) => line(FIELD.warning[lang], lintText(w, lang))),
      ...backtestLine(a, lang),
      ...switchLines(switches, lang),
      line(FIELD.note[lang], spec.trigger.channel === "comment" ? NOTE.commentScope[lang]() : NOTE.chatScope[lang]()),
      ...(rulesDryRun() ? [line(FIELD.note[lang], NOTE.testMode[lang])] : []),
      line(FIELD.note[lang], NOTE.startsNow[lang]),
    ];
    // Confirm activates this exact rule on this exact shop: the checked, normalised form, its hash and the shop's id replace whatever the model wrote.
    return { title: TITLE.create[lang], lines, pin: { spec, specHash: specHash(spec), shop: shop.store.id } };
  },
  async execute(ctx, args): Promise<WriteResult> {
    return guarded(ctx, async () => {
      requireOn();
      const spec = usable(args.spec);
      if (args.specHash && args.specHash !== specHash(spec)) refuse("The rule is not the one the card showed.");
      // The shop the card showed (its id is pinned); a shop that is gone is not replaced by another one.
      const shop = await ruleShopFor(ctx, args.shop, true);
      if ((await countStored(shop.store.id)) >= MAX_STORED_RULES) refuse("The shop's rule limit is reached.");
      // Checked again with the shop as it is now (another card may have created a rule meanwhile).
      const a = await assessRule(shop.store.id, spec, {});
      if (!a.ok) refuse("The rule no longer passes the checks.");
      const id = await insertRule({ tenantId: ctx.tenantId, storeId: shop.store.id, userId: ctx.userId, spec, sentence: ruleSentence(spec, ctx.lang) });
      // "Is on" must not hide that nothing is sent while the shop's automatic replies are off, or while the server is in test mode.
      const switches = await storeSwitches(shop.store.id);
      const off = !!switches && (!switches.automatic || !!switches.pausedReason);
      const text = [
        DONE.created[ctx.lang](spec.name),
        ...(shop.shopCount > 1 && shop.shopName ? [`${FIELD.shop[ctx.lang]}: ${shop.shopName}`] : []),
        ...(off ? [NOTE.autoOff[ctx.lang]] : []),
        ...(rulesDryRun() ? [NOTE.testMode[ctx.lang]] : []),
      ].join("\n");
      return { ok: true, text, data: { ruleId: id } };
    });
  },
});

const pause_rule = defineWrite({
  name: "pause_rule",
  description: "Pause one automatic rule so it stops acting; it can be switched back on later with resume_rule. rule: the rule's id from list_rules, or its exact name.",
  schema: ruleArg,
  kinds: ["shop"],
  permission: "configure",
  // It only makes the shop quieter.
  risk: "low",
  label: (lang) => LABEL.pauseRule[lang],
  async card(ctx, args): Promise<Card> {
    requireOn();
    const rule = await ruleOf(ctx, args.rule);
    if (rule.status === "ARCHIVED") refuse("That rule is deleted.");
    if (rule.status !== "ACTIVE") refuse("That rule is already paused.");
    const lang = ctx.lang;
    return {
      title: TITLE.pause[lang],
      lines: [
        ...(rule.shopName ? [line(FIELD.shop[lang], rule.shopName)] : []),
        line(FIELD.name[lang], rule.name),
        ...(rule.spec ? [line(FIELD.rule[lang], ruleSentence(rule.spec, lang))] : []),
        line(FIELD.note[lang], NOTE.pause[lang]),
      ],
      pin: { rule: rule.id },
    };
  },
  async execute(ctx, args): Promise<WriteResult> {
    return guarded(ctx, async () => {
      requireOn();
      const rule = await ruleOf(ctx, args.rule);
      if (!(await setRuleStatus(ctx.tenantId, rule.id, ["ACTIVE"], "PAUSED", "owner"))) refuse("The rule is not active any more.");
      return { ok: true, text: DONE.paused[ctx.lang](rule.name) };
    });
  },
});

const resume_rule = defineWrite({
  name: "resume_rule",
  description: "Switch a paused automatic rule back on. It is checked again like a new rule. rule: the rule's id from list_rules, or its exact name.",
  schema: ruleArg,
  kinds: ["shop"],
  permission: "configure",
  // The rule answers buyers by itself again: always a card.
  risk: "standing",
  label: (lang) => LABEL.resumeRule[lang],
  async card(ctx, args): Promise<Card> {
    requireOn();
    const rule = await ruleOf(ctx, args.rule);
    if (rule.status === "ARCHIVED") refuse("That rule is deleted and cannot be switched on again. Create a new rule instead.");
    if (rule.status === "ACTIVE") refuse("That rule is already on.");
    if (!rule.spec) refuse("That rule's stored definition can no longer be read. Suggest deleting it and creating it again.");
    const spec = usable(rule.spec);
    const [a, switches] = await Promise.all([assessRule(rule.storeId, spec, { exceptId: rule.id, backtestDays: BACKTEST_DAYS }), storeSwitches(rule.storeId)]);
    if (!a.ok) refuse(`The rule cannot be switched on as it is. ${problemLines(a.problems, a.preview).join(" ")}`);
    const lang = ctx.lang;
    return {
      title: TITLE.resume[lang],
      lines: [
        ...(rule.shopName ? [line(FIELD.shop[lang], rule.shopName)] : []),
        line(FIELD.name[lang], rule.name),
        line(FIELD.rule[lang], ruleSentence(spec, lang)),
        ...(keepsProductCard(spec) ? [line(FIELD.warning[lang], NOTE.cardKept[lang])] : []),
        ...a.warnings.map((w) => line(FIELD.warning[lang], lintText(w, lang))),
        ...backtestLine(a, lang),
        ...switchLines(switches, lang),
        line(FIELD.note[lang], NOTE.resume[lang]),
      ],
      pin: { rule: rule.id },
    };
  },
  async execute(ctx, args): Promise<WriteResult> {
    return guarded(ctx, async () => {
      requireOn();
      const rule = await ruleOf(ctx, args.rule);
      if (!rule.spec) refuse("The rule can no longer be read.");
      const spec = usable(rule.spec);
      const a = await assessRule(rule.storeId, spec, { exceptId: rule.id });
      if (!a.ok) refuse("The rule no longer passes the checks.");
      if (!(await setRuleStatus(ctx.tenantId, rule.id, ["PAUSED", "PAUSED_AUTO"], "ACTIVE", null))) refuse("The rule is not paused any more.");
      return { ok: true, text: DONE.resumed[ctx.lang](rule.name) };
    });
  },
});

const delete_rule = defineWrite({
  name: "delete_rule",
  description:
    "Delete an automatic rule. It stops at once and cannot be brought back from the app (its log is kept for 90 days). To change a rule, create a new one and delete the old one. rule: the rule's id from list_rules, or its exact name.",
  schema: ruleArg,
  kinds: ["shop"],
  permission: "configure",
  // Nothing in the app restores it: always a card.
  risk: "destructive",
  label: (lang) => LABEL.deleteRule[lang],
  async card(ctx, args): Promise<Card> {
    requireOn();
    const rule = await ruleOf(ctx, args.rule);
    if (rule.status === "ARCHIVED") refuse("That rule is already deleted.");
    const lang = ctx.lang;
    return {
      title: TITLE.delete[lang],
      lines: [
        ...(rule.shopName ? [line(FIELD.shop[lang], rule.shopName)] : []),
        line(FIELD.name[lang], rule.name),
        line(FIELD.status[lang], (VIEW.status[rule.status] ?? VIEW.status.PAUSED)[lang]),
        ...(rule.spec ? [line(FIELD.rule[lang], ruleSentence(rule.spec, lang))] : []),
        line(FIELD.note[lang], NOTE.delete[lang]()),
      ],
      pin: { rule: rule.id },
    };
  },
  async execute(ctx, args): Promise<WriteResult> {
    return guarded(ctx, async () => {
      requireOn();
      const rule = await ruleOf(ctx, args.rule);
      if (!(await setRuleStatus(ctx.tenantId, rule.id, ["ACTIVE", "PAUSED", "PAUSED_AUTO"], "ARCHIVED", "deleted"))) refuse("The rule is already deleted.");
      return { ok: true, text: DONE.deleted[ctx.lang](rule.name) };
    });
  },
});

export const RULE_WRITE_TOOLS: WriteTool[] = [create_rule, pause_rule, resume_rule, delete_rule];
