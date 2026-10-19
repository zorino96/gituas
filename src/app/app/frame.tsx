"use client";

// Picks the frame around a shop page. The chat routes get the chat frame (history sidebar, slim header, composer); every other
// screen keeps the classic frame (sidebar on a wide window, header, bottom tabs) exactly as it was. The layout is a server
// component that is not rendered again when the person moves between pages, so the choice is made here, from the address.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { ChatFrame, type ChatApi } from "./assistant/chat-shell";
import { ModeSwitch } from "./mode-switch";
import { SideNav, Tabs } from "./nav";

export interface ChatFrameConfig {
  api: ChatApi;
  support: { url: string; display: string };
}

export const isChatPath = (path: string): boolean => path === "/app/assistant" || path.startsWith("/app/assistant/");

export function AppFrame({
  kind,
  workspace,
  workspaceId,
  studio,
  video,
  chat,
  children,
}: {
  kind: "MERCHANT" | "NEWS";
  workspace: string;
  workspaceId: string;
  studio: boolean;
  video: boolean;
  /** Null while the chat is switched off: every route then uses the classic frame. */
  chat: ChatFrameConfig | null;
  children: React.ReactNode;
}) {
  const t = useT();
  const path = usePathname();

  if (chat && isChatPath(path)) {
    return (
      <ChatFrame api={chat.api} kind={kind} workspace={workspace} workspaceId={workspaceId} studio={studio} video={video} support={chat.support}>
        {children}
      </ChatFrame>
    );
  }

  return (
    <>
      <SideNav kind={kind} workspace={workspace} studio={studio} video={video} chat={!!chat} />
      <div className="gm-shell">
        <header className="gm-head">
          <div>
            <h1 className="kufi">{workspace}</h1>
            <small>{t.brand}</small>
          </div>
          <div className="gm-row" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
            <ModeSwitch />
            <Link href="/app/settings" className="gm-btn quiet small">
              <Settings size={15} aria-hidden="true" />
              {t.layout.settings}
            </Link>
          </div>
        </header>
        <main className="gm-main">{children}</main>
      </div>
      <Tabs kind={kind} studio={studio} video={video} chat={!!chat} />
    </>
  );
}
