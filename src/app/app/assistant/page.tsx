import { redirect } from "next/navigation";

import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { SUPPORT_WHATSAPP_DISPLAY, supportWhatsAppUrl } from "@/lib/support";
import { requireWorkspace } from "../data";
import { AssistantClient } from "./assistant-client";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const ws = await requireWorkspace();
  // A news desk has its own screens: the assistant knows the shop for now.
  if (ws.kind !== "MERCHANT") redirect("/newsroom");
  const d = dict(await getLang());
  // It looks at billing and automation settings: only people who can open those may use it.
  if (!can(ws.role, "configure")) return <p className="gm-note warn">{d.nr.team.roles.notAllowed}</p>;
  const t = d.assistant;
  return (
    <div>
      <h2 className="gm-title kufi">{t.title}</h2>
      <p className="gm-sub">{t.sub}</p>
      <AssistantClient workspaceId={ws.id} support={{ url: supportWhatsAppUrl(), display: SUPPORT_WHATSAPP_DISPLAY }} />
    </div>
  );
}
