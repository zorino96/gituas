"use client";

// The chat frame and screen with a pretend server (fixtures.ts), so the whole thing can be tried with no session.
// kind="news" shows the news desk's version: the desk's frame (DeskChatFrame), words and shortcuts, around the very same screen.

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { AppFrame } from "@/app/app/frame";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { ChatFrame } from "@/app/app/assistant/chat-shell";
import { ChatCard } from "@/app/app/settings/chat-card";
import { useT } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n/lang";
import { DeskChatFrame, DeskFrame } from "@/app/newsroom/desk-frame";
import { fakePut, fakeTransport, fixtureApi, fixtureThread, shopName, type DevKind, type Scenario } from "./fixtures";

export function Preview({ lang, scenario, kind = "shop" }: { lang: Lang; scenario: Scenario; kind?: DevKind }) {
  const router = useRouter();
  const t = useT();
  const api = useMemo(() => fixtureApi(lang, kind), [lang, kind]);
  const transport = useMemo(() => fakeTransport(lang, kind), [lang, kind]);
  const fixture = useMemo(() => fixtureThread(lang, scenario, kind), [lang, scenario, kind]);
  const support = { url: "https://wa.me/9647710106009", display: "+964 771 010 6009" };
  const here = (l: Lang) => `/dev/chat-first?lang=${l}&s=${scenario}${kind === "news" ? "&kind=news" : ""}`;
  const home = (s: Scenario) => `/dev/chat-first?lang=${lang}&s=${s}${kind === "news" ? "&kind=news" : ""}`;

  // Settings > Chat on its own (its buttons call the real server actions, which refuse with no session: the "not saved" line is what shows).
  if (scenario === "settings") {
    const desk = kind === "news";
    return (
      <main className="gm-main">
        <div className="gm-narrow">
          <p className="gm-sec">{t.chat.settings.sec}</p>
          <ChatCard initial={{ workspaceId: "dev", kind, autonomy: "LOW", canSetAutonomy: true, remaining: { day: 7, month: 120 }, allowancePercent: desk ? null : 42 }} />
          <p className="gm-sec">{t.chat.settings.sec} (admin view, read only)</p>
          <ChatCard initial={{ workspaceId: "dev", kind, autonomy: "ASK", canSetAutonomy: false, remaining: { day: 0, month: 0 }, allowancePercent: desk ? null : 100 }} />
          {desk && (
            <>
              <p className="gm-sec">{t.chat.settings.sec} (trial or plan ended)</p>
              <ChatCard initial={{ workspaceId: "dev", kind, autonomy: "ALL", canSetAutonomy: true, remaining: { day: 0, month: 0 }, allowancePercent: null, frozen: true }} />
            </>
          )}
        </div>
      </main>
    );
  }

  if (kind === "news") {
    const name = shopName(lang, "news");
    const desks = [
      { id: "dev", name, role: "Owner" },
      { id: "dev2", name: lang === "en" ? "Arabic desk" : lang === "ar" ? "المكتب العربي" : "بەشی عەرەبی", role: "Editor" },
    ];
    const banner = (
      <p className="gm-note nr-trial">
        {t.nr.shell.desk.trialLeft(9)}{" "}
        <a href="#plan" className="gm-link">
          {t.nr.shell.desk.choosePlan}
        </a>
      </p>
    );
    const workspace = { id: "dev", name };
    // The desk's own frame around a made-up screen: the "Assistant" entry it gets while the desk's chat is on.
    if (scenario === "classic" || scenario === "classic-off") {
      return (
        <DeskFrame workspace={workspace} desks={desks} roleLabel="Owner" banner={banner} chat={scenario === "classic" ? { api, support } : null}>
          <h2 className="gm-title kufi">{name}</h2>
          <p className="gm-sub">{scenario}</p>
        </DeskFrame>
      );
    }
    return (
      <DeskChatFrame
        workspace={workspace}
        desks={desks}
        banner={banner}
        chat={{ api, support }}
        onLang={(l) => router.push(here(l))}
        hrefs={{ newChat: home("empty"), thread: () => home("thread") }}
      >
        <ChatScreen
          key={`${lang}:${scenario}`}
          workspaceId="dev"
          thread={fixture.thread}
          initialMessages={fixture.messages}
          remaining={{ day: 7, month: 120 }}
          support={support}
          transport={transport}
          put={fakePut}
          urlFor={null}
          frozen={scenario === "frozen"}
        />
      </DeskChatFrame>
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
      onLang={(l) => router.push(here(l))}
      hrefs={{ newChat: home("empty"), thread: () => home("thread") }}
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
