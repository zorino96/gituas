// Who is asking: the session turned into an Actor, for the route handlers and the server actions. Nothing in the request body is
// trusted for this.

import { currentWorkspace } from "@/app/app/data";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { chatEnabled } from "./enabled";
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
  if (ws.kind !== "MERCHANT" || !can(ws.role, "configure")) return { ok: false, code: "forbidden", lang };
  return { ok: true, actor: { tenantId: ws.id, userId, role: ws.role, kind: "shop", lang }, workspaceName: ws.name };
}
