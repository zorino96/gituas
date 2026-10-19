import { redirect } from "next/navigation";

import { chatEnabled } from "@/lib/chat/enabled";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { profileEnabled } from "@/lib/shop/profile-shared";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { loadConnections, requireWorkspace } from "../data";
import { AssistantClient } from "./assistant-client";
import { getChatStateAction, getThreadAction } from "./chat-actions";
import { ChatScreen } from "./chat-screen";

export const dynamic = "force-dynamic";

/** A new chat. (A stored chat is /app/assistant/[id].) With CHAT_ENABLED=0 this is the older assistant screen, as it was. */
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ connected?: string }> }) {
  const ws = await requireWorkspace();
  // A news desk has its own screens: the assistant knows the shop for now.
  if (ws.kind !== "MERCHANT") redirect("/newsroom");
  const d = dict(await getLang());
  // It looks at billing and automation settings: only people who can open those may use it.
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  const [conns, sp] = await Promise.all([loadConnections(ws.id), searchParams]);
  const support = { url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY };
  // The first Facebook or Instagram connection of a shop with no store yet goes on to the setup interview (when it is switched on),
  // the way the Connect buttons in Settings do; a count that cannot be read just keeps the old landing place.
  const noStoreYet = profileEnabled() ? (await db.store.count({ where: { tenantId: ws.id } }).catch(() => -1)) === 0 : false;
  const connections = { facebook: !!conns.META_FACEBOOK.connected, instagram: !!conns.META_INSTAGRAM.connected, setupFirst: noStoreYet };

  if (!chatEnabled()) {
    const t = d.assistant;
    return (
      <div>
        <h2 className="gm-title kufi">{t.title}</h2>
        <p className="gm-sub">{t.sub}</p>
        <AssistantClient workspaceId={ws.id} support={support} connections={connections} justConnected={!!sp.connected} />
      </div>
    );
  }

  // The turns left are only a line under the box: if they cannot be read the chat still opens.
  const state = await getChatStateAction().catch(() => null);
  return (
    <ChatScreen
      workspaceId={ws.id}
      thread={null}
      initialMessages={[]}
      remaining={state?.ok ? state.remaining : null}
      support={support}
      connections={connections}
      justConnected={!!sp.connected}
      getThread={getThreadAction}
    />
  );
}
