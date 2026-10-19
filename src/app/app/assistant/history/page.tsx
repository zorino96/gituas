import { redirect } from "next/navigation";

import { chatEnabled } from "@/lib/chat/enabled";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { requireWorkspace } from "../../data";
import { listThreadsAction } from "../chat-actions";
import { ChatHistoryView } from "./history-view";

export const dynamic = "force-dynamic";

/** The menu's "Chat history": all the person's earlier chats of this shop. With the chat switched off there is no history to show. */
export default async function ChatHistoryPage() {
  const ws = await requireWorkspace();
  if (ws.kind !== "MERCHANT") redirect("/newsroom");
  if (!chatEnabled()) redirect("/app/assistant");
  const d = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  const res = await listThreadsAction({ workspaceId: ws.id });
  return <ChatHistoryView threads={res.ok ? res.threads : []} base="/app" d={d} now={Date.now()} />;
}
