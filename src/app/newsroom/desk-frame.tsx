"use client";

// Picks the frame around a desk screen, like the shop's AppFrame does. The chat routes (/newsroom/assistant and below) get the chat frame
// (history sidebar, slim header, composer); every other screen keeps the desk's own frame exactly as it was (sidebar on a wide window,
// top bar, phone bar). The layout is a server component that is not rendered again when the person moves between pages, so the choice is
// made here, from the address.

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ChatFrame, type ChatApi, type ChatHrefs } from "@/app/app/assistant/chat-shell";
import { ChatCopyProvider, useT } from "@/lib/i18n/client";
import type { Lang } from "@/lib/i18n/lang";
import { BottomNav, HelpLink, NAV_ICONS, SideNav } from "./desk-nav";
import { DESK_HREFS, DESK_SETTINGS_HREF, deskSectionItems, isDeskChatPath } from "./desk-chat";
import { DeskSwitcher, type DeskOption } from "./desk-switcher";

/** What the chat frame needs from the server: the thread actions and the support number. Null while the desk's chat is off. */
export interface DeskChatConfig {
  api: ChatApi;
  support: { url: string; display: string };
}

interface DeskProps {
  workspace: { id: string; name: string };
  desks: DeskOption[];
  /** The trial or frozen note (a server component): above the page, or in the chat's sidebar. */
  banner: ReactNode;
}

/** The chat frame of a desk: the desk's own brand, desk switcher, list of screens and Settings link around the shared chat frame. */
export function DeskChatFrame({
  workspace,
  desks,
  banner,
  chat,
  hrefs = DESK_HREFS,
  onLang,
  children,
}: DeskProps & {
  chat: DeskChatConfig;
  /** Where chats live. The dev preview points them at itself. */
  hrefs?: ChatHrefs;
  onLang?: (lang: Lang) => void;
  children: ReactNode;
}) {
  const t = useT();
  const labels = t.nr.shell.nav.items;
  return (
    <ChatCopyProvider kind="news">
      <ChatFrame
        api={chat.api}
        kind="NEWS"
        workspace={workspace.name}
        workspaceId={workspace.id}
        studio={false}
        video={false}
        support={chat.support}
        hrefs={hrefs}
        onLang={onLang}
        // The desk's own mark and name; the desk's name and the way to another desk sit under it.
        brand={
          <>
            <span className="nr-live" aria-hidden="true" />
            <div>
              <p className="kufi">{t.nr.shell.name}</p>
            </div>
          </>
        }
        sideTop={
          <div className="ch-desk">
            <DeskSwitcher currentId={workspace.id} currentName={workspace.name} desks={desks} />
          </div>
        }
        sideNote={banner}
        sections={deskSectionItems().map((i) => ({ href: i.href, label: labels[i.key], Icon: NAV_ICONS[i.key] }))}
        settings={{ href: DESK_SETTINGS_HREF, label: labels.settings }}
        headEnd={<HelpLink />}
        // The desk has no "last used face" to remember: it opens on its stories, not on the chat.
        face={false}
      >
        {children}
      </ChatFrame>
    </ChatCopyProvider>
  );
}

export function DeskFrame({
  workspace,
  desks,
  roleLabel,
  banner,
  chat,
  children,
}: DeskProps & {
  roleLabel: string;
  /** Null: the desk's chat is off for this person (the switch, or a role that may not use it), so every route uses the desk's own frame. */
  chat: DeskChatConfig | null;
  children: ReactNode;
}) {
  const path = usePathname();

  if (chat && isDeskChatPath(path)) {
    return (
      <DeskChatFrame workspace={workspace} desks={desks} banner={banner} chat={chat}>
        {children}
      </DeskChatFrame>
    );
  }

  return (
    <>
      <SideNav chat={!!chat} />
      <div className="gm-shell">
        <header className="nr-top">
          <DeskSwitcher currentId={workspace.id} currentName={workspace.name} desks={desks} />
          <div className="gm-row" style={{ gap: 8 }}>
            <span className="gm-badge ghost">{roleLabel}</span>
            <HelpLink />
          </div>
        </header>
        <main className="gm-main">
          {banner}
          {children}
        </main>
      </div>
      <BottomNav chat={!!chat} />
    </>
  );
}
