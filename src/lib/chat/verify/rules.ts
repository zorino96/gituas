// Read-backs of the owner-rule changes. After a rule is created, paused, switched back on or deleted, the rule is read again from the
// database and compared with what was asked. Read-only, always inside the workspace (tenantId), at most two queries in parallel.
// A check that cannot tell returns null; a problem is only a clear mismatch (row missing, wrong status, spec differs).

import { db } from "@/lib/db";
import { rulesDryRun } from "@/lib/shop/rules/enabled";
import { canonicalJson, parseRuleSpec, specHash } from "@/lib/shop/rules/spec";
import { quoted } from "../tools/rules-words";
import { clip, say, words, type Words } from "../tools/writes-common";
import type { ToolCtx, VerifyFn, VerifyReport } from "../types";

// ---------------------------------------------------------------------------------------------------------------------
// The person's words (Sorani, Arabic, English)

const STATE: Record<string, Words> = {
  ACTIVE: words("کار دەکات", "تعمل", "on"),
  PAUSED: words("وەستێندراوە", "متوقفة", "paused"),
  PAUSED_AUTO: words("خۆی وەستاوە", "توقفت من تلقاء نفسها", "stopped by itself"),
  ARCHIVED: words("سڕاوەتەوە", "محذوفة", "deleted"),
};

const W = {
  createdOn: say(
    (n: string) => `یاسای ${n} پاشەکەوت کراوە و کار دەکات.`,
    (n: string) => `القاعدة ${n} محفوظة وتعمل.`,
    (n: string) => `The rule ${n} is saved and on.`,
  ),
  same: words(
    "یاسا پاشەکەوتکراوەکە هەمان ئەو یاسایەیە کە لە کارتەکەدا بینیت.",
    "القاعدة المحفوظة هي نفسها التي ظهرت في البطاقة.",
    "The saved rule is exactly the one the card showed.",
  ),
  readable: words(
    "یاسا پاشەکەوتکراوەکە دەخوێنرێتەوە.",
    "يمكن قراءة القاعدة المحفوظة.",
    "The saved rule can be read back.",
  ),
  dryRun: words(
    "یاساکان هێشتا لە دۆخی تاقیکردنەوەدان: تەنها تۆمار دەکەن چییان دەکرد و هیچ نانێرن.",
    "القواعد الآن في وضع التجربة: تسجّل ما كانت ستفعله ولا ترسل شيئًا.",
    "Rules are in test mode for now: they only record what they would do and send nothing.",
  ),
  createMissing: words(
    "دوای پاشەکەوتکردن، یاساکەم لە لیستی یاساکانت نەدۆزییەوە.",
    "لم أجد القاعدة في قائمة قواعدك بعد حفظها.",
    "After saving, I could not find the rule in your list of rules.",
  ),
  createdNotOn: say(
    (n: string, s: string) => `یاسای ${n} پاشەکەوت کراوە، بەڵام کار ناکات (${s}).`,
    (n: string, s: string) => `القاعدة ${n} محفوظة لكنها لا تعمل (${s}).`,
    (n: string, s: string) => `The rule ${n} is saved, but it is not on (${s}).`,
  ),
  unreadable: words(
    "یاسا پاشەکەوتکراوەکە ناخوێنرێتەوە، بۆیە کار ناکات.",
    "تعذّرت قراءة القاعدة المحفوظة، لذلك لن تعمل.",
    "The saved rule cannot be read back, so it will not run.",
  ),
  diffTrigger: words(
    "ئەوەی یاسا پاشەکەوتکراوەکە لێی دەگەڕێت جیاوازە لەوەی لە کارتەکەدا بینیت.",
    "ما تبحث عنه القاعدة المحفوظة يختلف عمّا ظهر في البطاقة.",
    "What the saved rule looks for is different from what the card showed.",
  ),
  diffActions: words(
    "ئەوەی یاسا پاشەکەوتکراوەکە دەیکات جیاوازە لەوەی لە کارتەکەدا بینیت.",
    "ما تفعله القاعدة المحفوظة يختلف عمّا ظهر في البطاقة.",
    "What the saved rule does is different from what the card showed.",
  ),
  diffRest: words(
    "ناو یان سنوور یان نموونەکانی یاسا پاشەکەوتکراوەکە لەگەڵ کارتەکە جیاوازن.",
    "اسم القاعدة المحفوظة أو حدودها أو أمثلتها تختلف عن البطاقة.",
    "The saved rule's name, limits or examples are different from the card.",
  ),
  pausedOk: say(
    (n: string) => `یاسای ${n} وەستێندراوە و کار ناکات هەتا دووبارە دایبگیرسێنیتەوە.`,
    (n: string) => `القاعدة ${n} متوقفة ولن تعمل حتى تعيد تشغيلها.`,
    (n: string) => `The rule ${n} is paused and will not act until you switch it back on.`,
  ),
  stillOn: say(
    (n: string) => `یاسای ${n} هێشتا کار دەکات.`,
    (n: string) => `القاعدة ${n} ما زالت تعمل.`,
    (n: string) => `The rule ${n} is still on.`,
  ),
  gone: words("ئەو یاسایەم نەدۆزییەوە.", "لم أجد تلك القاعدة.", "I could not find that rule any more."),
  resumedOn: say(
    (n: string) => `یاسای ${n} دووبارە کار دەکات.`,
    (n: string) => `القاعدة ${n} تعمل من جديد.`,
    (n: string) => `The rule ${n} is on again.`,
  ),
  stillOff: say(
    (n: string, s: string) => `یاسای ${n} هێشتا کار ناکات (${s}).`,
    (n: string, s: string) => `القاعدة ${n} ما زالت لا تعمل (${s}).`,
    (n: string, s: string) => `The rule ${n} is still not on (${s}).`,
  ),
  deletedOk: say(
    (n: string) => `یاسای ${n} سڕاوەتەوە و چیتر کار ناکات.`,
    (n: string) => `تم حذف القاعدة ${n} ولن تعمل بعد الآن.`,
    (n: string) => `The rule ${n} is deleted and no longer runs.`,
  ),
  notListed: words(
    "یاساکە چیتر لە لیستی یاساکانتدا نییە.",
    "لم تعد القاعدة في قائمة قواعدك.",
    "The rule is no longer in your list of rules.",
  ),
  stillThere: say(
    (n: string, s: string) => `یاسای ${n} هێشتا ماوە (${s}).`,
    (n: string, s: string) => `القاعدة ${n} ما زالت موجودة (${s}).`,
    (n: string, s: string) => `The rule ${n} is still there (${s}).`,
  ),
};

// What the model is told to do about each problem (English, at most 300 characters).
const FIX = {
  createMissing:
    "After create_rule the rule was not found. Call list_rules to see what exists; if it is not there, tell the owner and offer to try again (preview_rule, then create_rule).",
  createdNotOn: (status: string) =>
    `The new rule is saved but not on (status ${status}). If the owner wants it on, call resume_rule with the rule's id (needs a card); if it was deleted, create it again with create_rule.`,
  unreadable:
    "The stored rule cannot be read. Offer to delete it (delete_rule with its id) and create it again (preview_rule, then create_rule).",
  differs:
    "The saved rule differs from the card. Call get_rule with the rule's id to see it, then offer to delete it (delete_rule) and create the approved rule again with create_rule.",
  stillOn: "The rule is still on. Offer to call pause_rule again with the rule's id; if that fails, tell the owner plainly that it is still on.",
  gone: "The rule is not in the list any more. Call list_rules to see what exists and tell the owner.",
  stillOff: (status: string) =>
    `The rule is still not on (status ${status}). Offer to call resume_rule again with the rule's id; if it was deleted, offer to create it again with create_rule.`,
  stillThere: (status: string) => `The rule still exists (status ${status}). Offer to call delete_rule again with the rule's id.`,
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading

const SELECT = { id: true, name: true, status: true, spec: true, specHash: true } as const;
interface Row {
  id: string;
  name: string;
  status: string;
  spec: unknown;
  specHash: string;
}

const LIVE = ["ACTIVE", "PAUSED", "PAUSED_AUTO"];
/** A rule id as the database makes it (cuid). A hint that looks like one is an id; anything else is a name. */
const ID_LIKE = /^c[a-z0-9]{20,}$/;
const HASH = /^[0-9a-f]{64}$/;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const hintOf = (args: unknown): string | null => {
  const r = obj(args)?.rule;
  return typeof r === "string" && r.trim() ? r.trim().slice(0, 120) : null;
};
const nameOf = (row: Row, lang: ToolCtx["lang"]): string => quoted(clip(row.name, 60), lang);
const stateOf = (status: string, lang: ToolCtx["lang"]): string => STATE[status][lang];
const known = (status: string): boolean => Object.prototype.hasOwnProperty.call(STATE, status);

/** The rule the tool's argument points at (an id, else an exact name among the rules that are not deleted), in this workspace only. */
async function locate(ctx: ToolCtx, hint: string): Promise<{ idLike: boolean; row: Row | null; named: Row[] }> {
  const idLike = ID_LIKE.test(hint);
  const [row, named] = await Promise.all([
    db.shopRule.findFirst({ where: { tenantId: ctx.tenantId, id: hint }, select: SELECT }),
    idLike
      ? Promise.resolve([] as Row[])
      : db.shopRule.findMany({ where: { tenantId: ctx.tenantId, status: { in: LIVE }, name: { equals: hint, mode: "insensitive" } }, take: 3, select: SELECT }),
  ]);
  return { idLike, row, named };
}

interface Found {
  problem: string;
  fix: string;
}
const report = (checked: string[], problems: Found[]): VerifyReport | null =>
  checked.length || problems.length ? { status: problems.length ? "problem" : "ok", checked, problems: problems.map((p) => p.problem), ...(problems.length ? { fix: problems[0].fix } : {}) } : null;

/** The rule the argument points at: by id first, else the one rule with that exact name. null = nothing, or not one rule for certain. */
const pick = (l: { row: Row | null; named: Row[] }): Row | null => l.row ?? (l.named.length === 1 ? l.named[0] : null);

// ---------------------------------------------------------------------------------------------------------------------
// The four checks

const verifyCreate: VerifyFn = async (ctx, args, done) => {
  const a = obj(args);
  if (!a) return null;
  const lang = ctx.lang;
  const parsed = a.spec === undefined ? null : parseRuleSpec(a.spec);
  const given = parsed?.ok ? parsed.spec : null;
  const givenHash = given ? specHash(given) : null;
  const pinned = typeof a.specHash === "string" && HASH.test(a.specHash) ? a.specHash : null;
  // Arguments that disagree with their own hash are not the ones the card pinned: there is nothing to compare the rule with.
  const expected = given && (!pinned || pinned === givenHash) ? given : null;
  const lookupHash = pinned ?? givenHash;

  const id = obj(done.data)?.ruleId;
  const ruleId = typeof id === "string" && id.trim() ? id.trim() : null;
  if (!ruleId && !lookupHash) return null;
  const row: Row | null = ruleId
    ? await db.shopRule.findFirst({ where: { tenantId: ctx.tenantId, id: ruleId }, select: SELECT })
    : await db.shopRule.findFirst({ where: { tenantId: ctx.tenantId, specHash: lookupHash as string }, orderBy: { createdAt: "desc" }, select: SELECT });
  // The tool named the rule it stored and it is not there: a clear miss. Found by its hash only, absence proves little.
  if (!row) return ruleId ? report([], [{ problem: W.createMissing[lang], fix: FIX.createMissing }]) : null;
  if (!known(row.status)) return null;

  const n = nameOf(row, lang);
  const checked: string[] = [];
  const problems: Found[] = [];
  if (row.status === "ACTIVE") checked.push(W.createdOn[lang](n));
  else problems.push({ problem: W.createdNotOn[lang](n, stateOf(row.status, lang)), fix: FIX.createdNotOn(row.status) });

  const stored = parseRuleSpec(row.spec);
  if (!stored.ok) problems.push({ problem: W.unreadable[lang], fix: FIX.unreadable });
  else if (!expected) checked.push(W.readable[lang]);
  else if (specHash(stored.spec) === specHash(expected)) checked.push(W.same[lang]);
  else {
    const differs = (x: unknown, y: unknown): boolean => canonicalJson(x) !== canonicalJson(y);
    const triggerDiffers = differs(stored.spec.trigger, expected.trigger);
    const actionsDiffer = differs(stored.spec.actions, expected.actions);
    if (triggerDiffers) problems.push({ problem: W.diffTrigger[lang], fix: FIX.differs });
    if (actionsDiffer) problems.push({ problem: W.diffActions[lang], fix: FIX.differs });
    // The hash differs but the trigger and the actions agree: the name, the limits, the examples or the wait differ.
    if (!triggerDiffers && !actionsDiffer) problems.push({ problem: W.diffRest[lang], fix: FIX.differs });
  }
  // Rules in test mode only log: a plain fact the owner should know about a rule that is on.
  if (row.status === "ACTIVE" && rulesDryRun()) checked.push(W.dryRun[lang]);
  return report(checked, problems);
};

const verifyPause: VerifyFn = async (ctx, args) => {
  const hint = hintOf(args);
  if (!hint) return null;
  const found = await locate(ctx, hint);
  const row = pick(found);
  const lang = ctx.lang;
  if (!row) return found.idLike ? report([], [{ problem: W.gone[lang], fix: FIX.gone }]) : null;
  const n = nameOf(row, lang);
  if (row.status === "PAUSED" || row.status === "PAUSED_AUTO") return report([W.pausedOk[lang](n)], []);
  if (row.status === "ACTIVE") return report([], [{ problem: W.stillOn[lang](n), fix: FIX.stillOn }]);
  // Deleted meanwhile: it does not act, but "paused" is not what is stored. Nothing clear to say either way.
  return null;
};

const verifyResume: VerifyFn = async (ctx, args) => {
  const hint = hintOf(args);
  if (!hint) return null;
  const found = await locate(ctx, hint);
  const row = pick(found);
  const lang = ctx.lang;
  if (!row) return found.idLike ? report([], [{ problem: W.gone[lang], fix: FIX.gone }]) : null;
  if (!known(row.status)) return null;
  const n = nameOf(row, lang);
  if (row.status !== "ACTIVE") return report([], [{ problem: W.stillOff[lang](n, stateOf(row.status, lang)), fix: FIX.stillOff(row.status) }]);
  // On, but the pipeline skips a rule whose stored definition no longer parses.
  if (!parseRuleSpec(row.spec).ok) return report([W.resumedOn[lang](n)], [{ problem: W.unreadable[lang], fix: FIX.unreadable }]);
  return report([W.resumedOn[lang](n), W.readable[lang], ...(rulesDryRun() ? [W.dryRun[lang]] : [])], []);
};

const verifyDelete: VerifyFn = async (ctx, args) => {
  const hint = hintOf(args);
  if (!hint) return null;
  const found = await locate(ctx, hint);
  const lang = ctx.lang;
  if (found.row) {
    const row = found.row;
    if (!known(row.status)) return null;
    const n = nameOf(row, lang);
    if (row.status === "ARCHIVED") return report([W.deletedOk[lang](n)], []);
    return report([], [{ problem: W.stillThere[lang](n, stateOf(row.status, lang)), fix: FIX.stillThere(row.status) }]);
  }
  // No row with that id in this workspace: it is gone. A name that still finds a live rule might be a newer rule of the same name.
  if (found.idLike || !found.named.length) return report([W.notListed[lang]], []);
  return null;
};

export const RULE_VERIFIERS: Record<string, VerifyFn> = {
  create_rule: verifyCreate,
  pause_rule: verifyPause,
  resume_rule: verifyResume,
  delete_rule: verifyDelete,
};
