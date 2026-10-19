import { notFound, redirect } from "next/navigation";

import { requireWorkspace } from "@/app/app/data";
import { listThreadsAction } from "@/app/app/assistant/chat-actions";
import { ChatHistoryView } from "@/app/app/assistant/history/history-view";
import { newsChatEnabled } from "@/lib/chat/enabled";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";

export const dynamic = "force-dynamic";

/** The desk's "Chat history": all the person's earlier chats of this desk. */
export default async function DeskChatHistoryPage() {
  const ws = await requireWorkspace("/newsroom/assistant/history");
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/app/assistant/history");
  const d = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  if (ws.kind !== "NEWS") notFound();
  if (!newsChatEnabled(ws.id)) redirect("/newsroom/assistant");
  const res = await listThreadsAction({ workspaceId: ws.id });
  return <ChatHistoryView threads={res.ok ? res.threads : []} base="/newsroom" d={d} now={Date.now()} />;
}
