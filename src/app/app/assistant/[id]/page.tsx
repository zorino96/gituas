import { coachEnabled } from "@/lib/coach/enabled";
import { redirect } from "next/navigation";

import { chatEnabled } from "@/lib/chat/enabled";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { requireWorkspace } from "../../data";
import { getThreadAction } from "../chat-actions";
import { ChatScreen } from "../chat-screen";

export const dynamic = "force-dynamic";

/** A stored chat, opened from the history. */
export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await requireWorkspace(`/app/assistant/${id}`);
  if (ws.kind !== "MERCHANT") redirect("/newsroom");
  const d = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  // With the chat switched off there is only the older assistant, at /app/assistant.
  if (!chatEnabled()) redirect("/app/assistant");

  const r = await getThreadAction({ id });
  if (!r.ok) {
    // A chat that was deleted (a link kept in the history of the browser) opens a new one instead.
    if (r.code === "not_found") redirect("/app/assistant");
    return <p className="gm-note warn">{d.chat.errors[r.code]}</p>;
  }
  return (
    <ChatScreen
      coachOn={coachEnabled()}
      // Another chat is another screen: nothing of the one before may stay in its state.
      key={r.thread.id}
      workspaceId={ws.id}
      thread={r.thread}
      initialMessages={r.messages}
      remaining={r.remaining}
      support={{ url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY }}
      getThread={getThreadAction}
      // A turn of this chat still running (the page was reloaded mid-answer): the screen waits for the answer.
      busy={r.busy}
    />
  );
}
