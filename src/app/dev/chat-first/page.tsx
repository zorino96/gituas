import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import "@/app/app/app.css";
import "@/app/newsroom/newsroom.css";
import { dirOf, getLang, isLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/i18n/client";
import { Preview } from "./preview";
import { SCENARIOS, type DevKind, type Scenario } from "./fixtures";

export const dynamic = "force-dynamic";

/**
 * Dev only: the chat-first screen and its sidebar with a pretend server, to see them without signing in.
 *   /dev/chat-first?lang=ckb|ar|en&s=thread|runs|long|empty|connect|classic|classic-off|settings|frozen&kind=shop|news
 * thread: a conversation with stats, a table, a list and a card waiting; runs: a card in every state; long: words that must wrap;
 * empty: the greeting; connect: the greeting in a shop with nothing connected; settings: Settings > Chat; classic: the frame around the
 * other screens. Typing anything streams a made-up answer. kind=news shows the news desk's version (the desk's tokens, brand, shortcuts,
 * sections and words) instead of the shop's.
 */
export default async function DevChatFirstPage({ searchParams }: { searchParams: Promise<{ lang?: string; s?: string; kind?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const lang = isLang(sp.lang) ? sp.lang : await getLang();
  const scenario: Scenario = SCENARIOS.find((s) => s === sp.s) ?? "thread";
  const kind: DevKind = sp.kind === "news" ? "news" : "shop";
  return (
    <div className={`gm ${kind === "news" ? "nr " : ""}${gmFontVars}`} dir={dirOf(lang)} lang={lang}>
      <LangProvider lang={lang}>
        <Preview lang={lang} scenario={scenario} kind={kind} />
      </LangProvider>
    </div>
  );
}
