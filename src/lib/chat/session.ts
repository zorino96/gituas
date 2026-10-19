// Who is asking: the session turned into an Actor, for the route handlers and the server actions. Nothing in the request body is
// trusted for this.

import { currentWorkspace } from "@/app/app/data";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { chatEnabled, newsChatEnabled } from "./enabled";
import type { Actor } from "./confirm";
import type { ChatErrorCode } from "./types";

export type ActorResult = { ok: true; actor: Actor; workspaceName: string } | { ok: false; code: ChatErrorCode; lang: Actor["lang"] };

/** The signed-in person in their current workspace, if the chat is open to them: a shop, an owner or an admin. */
export async function actorFromSession(): Promise<ActorResult> {
  const lang = await getLang();
  if (!chatEnabled()) return { ok: false, code: "forbidden", lang };
  const session = await auth();
  const userId = session?.user?.id;
  const ws = userId ? await currentWorkspace() : null;
  if (!userId || !ws) return { ok: false, code: "signin", lang };
  if (!can(ws.role, "configure")) return { ok: false, code: "forbidden", lang };
  if (ws.kind === "MERCHANT") return { ok: true, actor: { tenantId: ws.id, userId, role: ws.role, kind: "shop", lang }, workspaceName: ws.name };
  if (ws.kind === "NEWS" && newsChatEnabled(ws.id)) return { ok: true, actor: { tenantId: ws.id, userId, role: ws.role, kind: "news", lang }, workspaceName: ws.name };
  return { ok: false, code: "forbidden", lang };
}
