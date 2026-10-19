import { notFound, redirect } from "next/navigation";

import { requireWorkspace } from "@/app/app/data";
import { AssistantClient } from "@/app/app/assistant/assistant-client";
import { getChatStateAction, getThreadAction } from "@/app/app/assistant/chat-actions";
import { ChatScreen } from "@/app/app/assistant/chat-screen";
import { newsChatEnabled } from "@/lib/chat/enabled";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { loadDeskAccess } from "../../desk-access";

export const dynamic = "force-dynamic";
// A frame designed from the older assistant takes up to a minute (the chat's own turns run in /api/chat).
export const maxDuration = 60;

/**
 * The assistant of a news desk. With NEWS_CHAT_ENABLED=1 this is a new chat (a stored chat is /newsroom/assistant/[id]); otherwise it is
 * the older assistant, as it was: it explains Hawalnoos and does the frame work for the desk, after a confirmation.
 */
export default async function DeskAssistantPage() {
  const ws = await requireWorkspace("/newsroom/assistant");
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/app/assistant");
  const d = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  if (ws.kind !== "NEWS") notFound();
  const support = { url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY };

  if (newsChatEnabled()) {
    // The turns left are only a line under the box: if they cannot be read the chat still opens.
    const [state, access] = await Promise.all([getChatStateAction().catch(() => null), loadDeskAccess(ws.id).catch(() => null)]);
    return (
      <ChatScreen
        workspaceId={ws.id}
        thread={null}
        initialMessages={[]}
        remaining={state?.ok ? state.remaining : null}
        support={support}
        getThread={getThreadAction}
        // No urlFor: the chat frame (DeskChatFrame) knows where the desk's chats live, and a function cannot cross from here to the screen.
        frozen={access?.active === false}
      />
    );
  }

  const t = d.assistant.news;
  return (
    <div>
      <h2 className="gm-title kufi">{t.title}</h2>
      <p className="gm-sub">{t.sub}</p>
      <AssistantClient workspaceId={ws.id} kind="news" support={support} connections={{ facebook: true, instagram: true }} justConnected={false} />
    </div>
  );
}
