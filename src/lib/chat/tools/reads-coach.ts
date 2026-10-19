// get_coach_note: the latest weekly note on the shop's own numbers (made on Sunday mornings by /api/cron/coach). Not untrusted: the note
// is built from counts and the owner's own words, never from a buyer's text. The quick chip "coach" runs this tool with no model, so
// reading the note costs no chat turn.

import { z } from "zod";

import { coachEnabled } from "@/lib/coach/enabled";
import { numbersOf } from "@/lib/coach/facts";
import { latestNote, type ReadNote } from "@/lib/coach/read";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";
import { defineRead, type ReadResult, type ReadTool, type ViewBlock } from "../types";
import { baghdadIso, isolateLtr } from "./reads-shared";

const WORDS: Record<Lang, { working: string; buyerMessages: string; comments: string; unreadable: string }> = {
  ckb: { working: "تێبینیی هەفتە دەخوێنمەوە…", buyerMessages: "نامەی کڕیاران", comments: "کۆمێنت", unreadable: "نەتوانرا تێبینییەکە بخوێنرێتەوە. دووبارە هەوڵبدەرەوە." },
  ar: { working: "أقرأ ملاحظة الأسبوع…", buyerMessages: "رسائل المشترين", comments: "التعليقات", unreadable: "تعذّرت قراءة الملاحظة. حاول مرة أخرى." },
  en: { working: "Reading the weekly note…", buyerMessages: "Buyer messages", comments: "Comments", unreadable: "The note could not be read. Try again." },
};

/** What the model reads: the sentences as the owner sees them, the key figures, and the label that must stay with them. */
export function noteForModel(n: ReadNote): Record<string, unknown> {
  const f = n.facts;
  return {
    week: n.week,
    madeBy: n.source === "ai" ? "AI wording of the shop's own numbers" : "fixed rules, no AI",
    preview: n.preview || undefined,
    madeAt: baghdadIso(n.madeAt),
    headline: n.body.headline,
    points: n.body.points.map((p) => p.text),
    tryThis: n.body.tryThis,
    figures: numbersOf(f),
    label: n.label,
    rules: "These are the shop's own numbers, not market data. Do not predict, promise or judge what the account is for. Quote only these numbers.",
  };
}

/** What the owner sees: the headline with the key figures, the points, the things to try, and the label line last. */
export function noteView(n: ReadNote, lang: Lang): ViewBlock[] {
  const t = dict(lang);
  const w = WORDS[lang];
  const f = n.facts;
  const sellsLess = f.goal.kind === "grow" || f.goal.kind === "other";
  const blocks: ViewBlock[] = [
    {
      kind: "stats",
      title: n.body.headline,
      items: [
        ...(sellsLess ? [] : [{ label: t.orders.week.orders, value: `${t.fmt.num(f.orders.week)} (${t.fmt.num(f.orders.before)})` }]),
        { label: w.buyerMessages, value: `${t.fmt.num(f.messages.dm)} (${t.fmt.num(f.messages.dmBefore)})` },
        { label: w.comments, value: `${t.fmt.num(f.messages.comments)} (${t.fmt.num(f.messages.commentsBefore)})` },
        { label: t.home.waitingMessages, value: t.fmt.num(f.waiting) },
        { label: t.home.postsThisWeek, value: t.fmt.num(f.posts.published) },
      ],
    },
    { kind: "list", title: `${t.coach.noteTitle} · ${isolateLtr(n.week)}`, items: n.body.points.map((p) => ({ title: p.text })) },
  ];
  if (n.body.tryThis.length) blocks.push({ kind: "list", title: t.coach.tryTitle, items: n.body.tryThis.map((x) => ({ title: x })) });
  if (n.preview) blocks.push({ kind: "note", text: t.coach.previewNote });
  blocks.push({ kind: "note", text: `${n.label} · ${n.source === "ai" ? t.coach.aiBadge : t.coach.rulesBadge}` });
  return blocks;
}

const get_coach_note = defineRead({
  name: "get_coach_note",
  description:
    "The latest weekly note on the shop's own numbers: a headline, the points the numbers show, and up to three things to try. It is made on Sunday mornings from the shop's orders, messages and posts (fixed rules on a Free plan, reworded by AI on a paid one); before the first one exists it is a quick rules-only reading made now. It says nothing about the market or the future. Use it when the owner asks how the week went or for the weekly note. It takes no arguments.",
  schema: z.object({}).strict(),
  kinds: ["shop"] as const,
  permission: "configure",
  risk: "read",
  label: (lang) => WORDS[lang].working,
  async run(ctx): Promise<ReadResult> {
    const t = dict(ctx.lang);
    if (!coachEnabled()) {
      return { data: { available: false, note: "The weekly note is not switched on for this account yet." }, view: [{ kind: "note", text: t.coach.off }] };
    }
    let note: ReadNote | null;
    try {
      note = await latestNote(ctx.tenantId, ctx.lang, { preview: true });
    } catch (e) {
      console.error("[coach] note read failed:", e instanceof Error ? e.name : "unknown error");
      return { data: { available: false, note: "The note could not be read right now. Ask the person to try again." }, view: [{ kind: "note", tone: "warn", text: WORDS[ctx.lang].unreadable }] };
    }
    if (!note) return { data: { available: false, note: "There is no weekly note yet." }, view: [{ kind: "note", text: t.coach.noNote }] };
    return { data: noteForModel(note), view: noteView(note, ctx.lang) };
  },
});

export const COACH_TOOLS: ReadTool[] = [get_coach_note];
