"use client";

// The chat frame and screen with a pretend server (fixtures.ts), so the whole thing can be tried with no session.

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { AppFrame } from "@/app/app/frame";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { ChatFrame } from "@/app/app/assistant/chat-shell";
import { ChatCard } from "@/app/app/settings/chat-card";
import { useT } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n/lang";
import { fakePut, fakeTransport, fixtureApi, fixtureThread, shopName, type Scenario } from "./fixtures";

export function Preview({ lang, scenario }: { lang: Lang; scenario: Scenario }) {
  const router = useRouter();
  const t = useT();
  const api = useMemo(() => fixtureApi(lang), [lang]);
  const transport = useMemo(() => fakeTransport(lang), [lang]);
  const fixture = useMemo(() => fixtureThread(lang, scenario), [lang, scenario]);
  const support = { url: "https://wa.me/9647710106009", display: "+964 771 010 6009" };

  // Settings > Chat on its own (its buttons call the real server actions, which refuse with no session: the "not saved" line is what shows).
  if (scenario === "settings") {
    return (
      <main className="gm-main">
        <div className="gm-narrow">
          <p className="gm-sec">{t.chat.settings.sec}</p>
          <ChatCard initial={{ workspaceId: "dev", autonomy: "LOW", canSetAutonomy: true, remaining: { day: 7, month: 120 }, allowancePercent: 42 }} />
          <p className="gm-sec">{t.chat.settings.sec} (admin view, read only)</p>
          <ChatCard initial={{ workspaceId: "dev", autonomy: "ASK", canSetAutonomy: false, remaining: { day: 0, month: 0 }, allowancePercent: 100 }} />
        </div>
      </main>
    );
  }

  // The classic frame around a made-up screen, to see the "New chat" entry it gets (classic) or the plain "Assistant" (classic-off: the chat is switched off).
  if (scenario === "classic" || scenario === "classic-off") {
    return (
      <AppFrame kind="MERCHANT" workspace={shopName(lang)} workspaceId="dev" studio={false} video chat={scenario === "classic" ? { api, support } : null}>
        <h2 className="gm-title kufi">{shopName(lang)}</h2>
        <p className="gm-sub">{scenario}</p>
      </AppFrame>
    );
  }

  return (
    <ChatFrame
      api={api}
      kind="MERCHANT"
      workspace={shopName(lang)}
      workspaceId="dev"
      studio={false}
      video
      support={support}
      onLang={(l) => router.push(`/dev/chat-first?lang=${l}&s=${scenario}`)}
      hrefs={{ newChat: `/dev/chat-first?lang=${lang}&s=empty`, thread: () => `/dev/chat-first?lang=${lang}&s=thread` }}
    >
      <ChatScreen
        key={`${lang}:${scenario}`}
        workspaceId="dev"
        thread={fixture.thread}
        initialMessages={fixture.messages}
        remaining={{ day: 7, month: 120 }}
        support={support}
        connections={scenario === "connect" ? { facebook: false, instagram: false } : undefined}
        transport={transport}
        put={fakePut}
        urlFor={null}
      />
    </ChatFrame>
  );
}
