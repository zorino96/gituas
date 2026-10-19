import { redirect } from "next/navigation";

import { requireWorkspace } from "@/app/app/data";
import { getThreadAction } from "@/app/app/assistant/chat-actions";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { newsChatEnabled } from "@/lib/chat/enabled";
import { dict, getLang } from "@/lib/i18n";
import { newsChat } from "@/lib/i18n/chat-news";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { loadDeskAccess } from "../../../desk-access";
import { DESK_HREFS } from "../../../desk-chat";

export const dynamic = "force-dynamic";

/** A stored chat of the news desk, opened from the history. */
export default async function DeskChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace(DESK_HREFS.thread(id));
  // A shop workspace never sees a desk's chat: the desk layout shows it the way to a desk instead.
  if (ws.kind !== "NEWS") return null;
  const lang = await getLang();
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{dict(lang).nr.team.roles.notAllowed}</p>;
  // With the desk's chat switched off there is only the older assistant, at /newsroom/assistant.
  if (!newsChatEnabled()) redirect(DESK_HREFS.newChat);

  const [r, access] = await Promise.all([getThreadAction({ id }), loadDeskAccess(ws.id).catch(() => null)]);
  if (!r.ok) {
    // A chat that was deleted (a link kept in the history of the browser) opens a new one instead.
    if (r.code === "not_found") redirect(DESK_HREFS.newChat);
    return <p className="gm-note warn">{newsChat(lang).errors[r.code]}</p>;
  }
  return (
    <ChatScreen
      // Another chat is another screen: nothing of the one before may stay in its state.
      key={r.thread.id}
      workspaceId={ws.id}
      thread={r.thread}
      initialMessages={r.messages}
      remaining={r.remaining}
      support={{ url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY }}
      getThread={getThreadAction}
      frozen={access?.active === false}
      // A turn of this chat still running (the page was reloaded mid-answer): the screen waits for the answer.
      busy={r.busy}
    />
  );
}
