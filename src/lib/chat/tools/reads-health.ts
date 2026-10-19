// check_everything: one look at what is wrong, or about to go wrong, in the workspace. READ-ONLY and database-only: it never calls
// Facebook or Instagram, and it reads counts and our own labels only (no buyer's words, no feed or story text), so it is NOT
// untrusted and a turn that uses it can still change things. The finders live in src/lib/chat/health/ (shop.ts, news.ts).
//
// All finders run at once, each in its own try/catch: one that throws or is slow yields no finding, never an error for the whole
// tool. The tool as a whole has a 12 second limit; what finished by then is reported, the rest is named in `notChecked`, and the
// answer is never "all clear" unless every finder ran.

import { z } from "zod";

import { newsFinders } from "../health/news";
import { shopFinders } from "../health/shop";
import { areaLabel, RANK, SEVERITY_BADGE, say, words, type Finder, type Finding, type HealthCtx, type Severity } from "../health/types";
import { baseOf } from "../kinds";
import { defineRead, type ReadResult, type ReadTool, type ViewBlock } from "../types";

/** The whole tool's limit. */
export const HEALTH_LIMIT_MS = 12_000;
/** The most findings the model and the person are given (the counts still cover all of them). */
export const MAX_FINDINGS = 12;

const W = {
  working: words("هەموو شتێک دەپشکنم…", "أفحص كل شيء…", "Checking everything…"),
  title: words("پشکنینی گشتی", "فحص شامل", "Full check"),
  // "All clear" always names what was looked at: the check reads our own records of a few areas, so it must never read as "everything is fine".
  clear: say(
    (areas: string) => `ئەمانەم پشکنی و هیچ کێشەیەکم نەدۆزییەوە: ${areas}.`,
    (areas: string) => `فحصت ${areas} ولم أجد أي مشكلة.`,
    (areas: string) => `All clear: I checked ${areas} and found nothing wrong.`,
  ),
  clearOfChecked: say(
    (areas: string) => `لەوەی توانیم بیپشکنم هیچ کێشەیەک نەدۆزرایەوە: ${areas}.`,
    (areas: string) => `لم أجد أي مشكلة فيما استطعت فحصه: ${areas}.`,
    (areas: string) => `I found nothing wrong in what I could check: ${areas}.`,
  ),
  partial: words("نەمتوانی ئەمانە بپشکنم:", "لم أستطع فحص:", "I could not check:"),
};

/** The areas in the person's words, as one list. */
const areaList = (areas: readonly string[], lang: HealthCtx["lang"]): string => areas.map((a) => areaLabel(a, lang)).join(lang === "en" ? ", " : "، ");

export interface HealthRun {
  /** Every finding of the finders that finished, highest severity first (finder order within one severity). */
  findings: Finding[];
  /** The areas whose finder finished. */
  checked: string[];
  /** The areas whose finder threw or did not finish in time. */
  notChecked: string[];
}

/**
 * Runs the finders at once. A finder that throws counts as not checked; when the limit passes, whatever finished is reported and
 * the rest is not checked. A finder that finishes after the cut-off is ignored.
 */
export async function runFinders(finders: Finder[], c: HealthCtx, limitMs: number = HEALTH_LIMIT_MS): Promise<HealthRun> {
  const done = new Map<Finder, Finding[]>();
  let closed = false;
  const work = finders.map(async (f) => {
    try {
      const found = await f.run(c);
      if (!closed) done.set(f, Array.isArray(found) ? found : []);
    } catch (e) {
      // The area and the kind of error only: an error message can carry a value from the database.
      console.error("[health] finder failed:", f.area, e instanceof Error ? e.name : "unknown error");
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limitMs);
  });
  try {
    await Promise.race([Promise.all(work), cutoff]);
  } finally {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
  }
  const ran = finders.filter((f) => done.has(f));
  const findings = ran.flatMap((f) => done.get(f) ?? []).sort((a, b) => RANK[a.severity] - RANK[b.severity]);
  return { findings, checked: ran.map((f) => f.area), notChecked: finders.filter((f) => !done.has(f)).map((f) => f.area) };
}

const countOf = (findings: readonly Finding[], s: Severity): number => findings.filter((f) => f.severity === s).length;

/** What the model reads. English keys; the sentences are in the person's language; every number is a count of our own records. */
export function healthForModel(r: HealthRun): Record<string, unknown> {
  const counts = { high: countOf(r.findings, "high"), medium: countOf(r.findings, "medium"), info: countOf(r.findings, "info") };
  const shown = r.findings.slice(0, MAX_FINDINGS);
  const partial = r.notChecked.length > 0;
  return {
    ok: counts.high + counts.medium === 0,
    allClear: r.findings.length === 0 && !partial,
    counts,
    findings: shown.map((f) => ({ area: f.area, severity: f.severity, text: f.text, fix: f.fix, ...(f.href ? { href: f.href } : {}) })),
    ...(r.findings.length > shown.length ? { moreNotShown: r.findings.length - shown.length } : {}),
    areasChecked: r.checked,
    ...(partial
      ? { partial: true, notChecked: r.notChecked, note: "Some areas could not be checked (an error or too slow). Say which ones, and do NOT say that everything is fine." }
      : {}),
    rules: [
      "These come from Gituas's own records, not from Facebook or Instagram right now.",
      "Say 'all clear' only when allClear is true, and name the areas in areasChecked with it: only those were looked at (not the WhatsApp, TikTok or YouTube connections, and nothing live on Facebook or Instagram), so never say that everything is fine.",
      "Offer the fix as a next step; change nothing without the person's card, and never say a problem is fixed until it was changed and read back.",
    ],
  };
}

/** What the person sees: the findings with a badge and what to do, or "all clear"; a warning naming the areas that could not be checked. */
export function healthView(r: HealthRun, lang: HealthCtx["lang"]): ViewBlock[] {
  const partial = r.notChecked.length > 0;
  const shown = r.findings.slice(0, MAX_FINDINGS);
  const blocks: ViewBlock[] = [];
  if (shown.length) {
    blocks.push({
      kind: "list",
      title: W.title[lang],
      items: shown.map((f) => ({ title: f.text, ...(f.todo ? { sub: f.todo } : {}), badge: SEVERITY_BADGE[f.severity][lang], ...(f.href ? { href: f.href } : {}) })),
      ...(r.findings.length > shown.length ? { more: r.findings.length - shown.length } : {}),
    });
  } else if (r.checked.length) {
    // Only the areas that really finished are named; if none did, only the warning below is shown.
    const areas = areaList(r.checked, lang);
    blocks.push({ kind: "note", text: partial ? W.clearOfChecked[lang](areas) : W.clear[lang](areas) });
  }
  if (partial) blocks.push({ kind: "note", tone: "warn", text: `${W.partial[lang]} ${areaList(r.notChecked, lang)}.` });
  return blocks;
}

const check_everything = defineRead({
  name: "check_everything",
  description:
    "Checks the whole workspace for what is wrong or about to go wrong, from Gituas's own records only (no call to Facebook or Instagram right now). " +
    "Shop: expired or missing Facebook/Instagram connections, posts that failed or are late, replies stuck or not sent, buyer comments and messages left over a day, " +
    "orders waiting over 24 hours, products without a price or a photo, no WhatsApp number, automatic replies off, a paid plan that ran out, rules that failed, chat actions that failed. " +
    "News desk: expired Page connections, failed or late posts, an autopilot that wrote nothing for a day, news sources that fail, a trial or plan that ended. " +
    "Use it when the owner presses 'check everything' or asks whether anything is wrong or about to go wrong. " +
    "It returns findings, most urgent first, each with a plain sentence and a fix. Offer each fix as a next step (the fix names the tool or screen) and change nothing without the person's card. " +
    "If notChecked is present, name those areas and never say that everything is fine; say 'all clear' only when allClear is true, and then name the areas in areasChecked. It takes no arguments.",
  schema: z.object({}).strict(),
  kinds: ["shop", "news"] as const,
  permission: "read",
  risk: "read",
  label: (lang) => W.working[lang],
  async run(ctx): Promise<ReadResult> {
    const hc: HealthCtx = { tenantId: ctx.tenantId, lang: ctx.lang, kind: ctx.kind, base: baseOf(ctx.kind), now: new Date() };
    const finders = ctx.kind === "news" ? newsFinders() : shopFinders();
    // The request has its own deadline: leave room to answer.
    const limit = Math.min(HEALTH_LIMIT_MS, Math.max(2_000, ctx.deadline - Date.now() - 3_000));
    const r = await runFinders(finders, hc, limit);
    return { data: healthForModel(r), view: healthView(r, ctx.lang) };
  },
});

export const HEALTH_READ_TOOLS: ReadTool[] = [check_everything];
