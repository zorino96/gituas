import { currentWorkspace, loadConnections, loadConversations } from "../data";
import { MessagesClient } from "./messages-client";

export default async function MessagesPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const { conversations, unreadable, errors } = await loadConversations(ws.id, conns);
  return (
    <MessagesClient
      initial={conversations}
      unreadable={unreadable}
      errors={errors}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
  );
}
