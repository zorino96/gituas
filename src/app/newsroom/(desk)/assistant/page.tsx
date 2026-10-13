import { notFound, redirect } from "next/navigation";

import { requireWorkspace } from "@/app/app/data";
import { AssistantClient } from "@/app/app/assistant/assistant-client";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";

export const dynamic = "force-dynamic";
// A frame designed from the chat takes up to a minute.
export const maxDuration = 60;

/** The assistant of a news desk: it explains Hawalnoos and does the frame work for the desk, after a confirmation. */
export default async function DeskAssistantPage() {
  const ws = await requireWorkspace("/newsroom/assistant");
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/app/assistant");
  const d = dict(await getLang());
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  if (ws.kind !== "NEWS") notFound();
  const t = d.assistant.news;
  return (
    <div>
      <h2 className="gm-title kufi">{t.title}</h2>
      <p className="gm-sub">{t.sub}</p>
      <AssistantClient
        workspaceId={ws.id}
        kind="news"
        support={{ url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY }}
        connections={{ facebook: true, instagram: true }}
        justConnected={false}
      />
    </div>
  );
}
