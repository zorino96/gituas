import { withAccounts } from "@/lib/oauth/account-scope";
import { AccountSwitcher } from "../account-switcher";
import { accountChoiceFrom, currentWorkspace, loadConnections, loadConversations } from "../data";
import { MessagesClient } from "./messages-client";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ fb?: string; ig?: string }> }) {
  const ws = (await currentWorkspace())!;
  const { choice, lists } = await accountChoiceFrom(ws.id, await searchParams);
  const { conns, conversations, unreadable, errors } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    return { conns, ...(await loadConversations(ws.id, conns)) };
  });
  return (
    <>
    <AccountSwitcher lists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM }} selected={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }} />
    <MessagesClient
      accounts={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }}
      initial={conversations}
      unreadable={unreadable}
      errors={errors}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
    </>
  );
}
