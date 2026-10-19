// A short title for a new thread, written by Haiku from what the OWNER first said (never from an answer or a tool result, which
// can carry a customer's words). It costs a few hundred tokens, is counted like any other call, and every failure leaves the
// thread with the first words of the message as its title.

import { completeJson } from "@/lib/ai/provider";
import type { Meter } from "@/lib/ai/meter";
import type { Lang } from "@/lib/i18n/lang";
import { cleanAnswer } from "./guard";
import { LANG_NAME } from "./text";

export async function titleFor(text: string, lang: Lang, meter?: Meter): Promise<string | null> {
  try {
    const { data } = await completeJson<{ title: string }>(
      {
        system: `Write a title of at most five words for a chat that starts with the owner's message below. Use the language of the message (${LANG_NAME[lang]} when it is unclear). No quotation marks, no full stop, nothing but the title. Reply with {"title": "..."}.`,
        user: `<<<\n${text.slice(0, 300)}\n>>>`,
        strength: "fast",
        tier: "haiku",
        meter,
        maxTokens: 60,
        budgetMs: 9_000,
      },
      (d) => {
        const t = (d as { title?: unknown } | null)?.title;
        return typeof t === "string" && t.trim() ? { title: t } : null;
      },
    );
    const title = cleanAnswer(data.title.replace(/["«»“”]/g, "").replace(/\.$/, "").replace(/\s+/g, " ").trim(), 60);
    return title.length >= 2 ? title : null;
  } catch {
    return null;
  }
}
