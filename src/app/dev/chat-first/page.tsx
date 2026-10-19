import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import { dirOf, getLang, isLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { Preview } from "./preview";
import { SCENARIOS, type Scenario } from "./fixtures";

export const dynamic = "force-dynamic";

/**
 * Dev only: the chat-first screen and its sidebar with a pretend server, to see them without signing in.
 *   /dev/chat-first?lang=ckb|ar|en&s=thread|runs|long|empty|connect
 * thread: a conversation with stats, a table, a list and a card waiting; runs: a card in every state; long: words that must wrap;
 * empty: the greeting; connect: the greeting in a shop with nothing connected. Typing anything streams a made-up answer.
 */
export default async function DevChatFirstPage({ searchParams }: { searchParams: Promise<{ lang?: string; s?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const lang = isLang(sp.lang) ? sp.lang : await getLang();
  const scenario: Scenario = SCENARIOS.find((s) => s === sp.s) ?? "thread";
  return (
    <div className={`gm ${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>
        <Preview lang={lang} scenario={scenario} />
      </LangProvider>
    </div>
  );
}
