import { db } from "@/lib/db";
import { withAccounts } from "@/lib/oauth/account-scope";
import { AccountSwitcher } from "../account-switcher";
import { accountChoiceFrom, currentWorkspace, loadConnections, loadConversations, requireWorkspace } from "../data";
import { MessagesClient } from "./messages-client";

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ fb?: string; ig?: string }> }) {
  const ws = await requireWorkspace();
  const { choice, lists } = await accountChoiceFrom(ws.id, await searchParams);
  const { conns, conversations, unreadable, errors } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    return { conns, ...(await loadConversations(ws.id, conns)) };
  });
  // Buyers with an open order: their chats go in the Orders tab.
  const ids = conversations.map((c) => c.participantId).filter((id): id is string => !!id);
  const orderBuyers =
    ws.kind === "NEWS"
      ? undefined
      : ids.length
        ? (await db.order.findMany({ where: { tenantId: ws.id, buyerKey: { in: ids }, status: { in: ["NEW", "CONFIRMED"] } }, select: { buyerKey: true } })).map((o) => o.buyerKey!)
        : [];
  // Chats whose last message the assistant could not make out, or that it wants the owner to look at.
  const flags: Record<string, string> = {};
  if (ws.kind !== "NEWS" && ids.length) {
    const rows = await db.conversationMessage.findMany({
      where: { store: { tenantId: ws.id }, channelType: "DM", direction: "INBOUND", authorId: { in: ids }, createdAt: { gt: new Date(Date.now() - 3 * 86_400_000) } },
      orderBy: { createdAt: "desc" },
      select: { authorId: true, outcomeReason: true },
      take: 400,
    });
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.authorId || seen.has(r.authorId)) continue;
      seen.add(r.authorId);
      // Only the buyer's latest message counts: once a later one was answered, the chat is out of the pile.
      if (r.outcomeReason === "unclear" || r.outcomeReason === "needs_you") flags[r.authorId] = r.outcomeReason;
    }
  }
  return (
    <>
    <AccountSwitcher lists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM }} selected={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }} />
    <MessagesClient
      accounts={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }}
      initial={conversations}
      orderBuyers={orderBuyers}
      flags={flags}
      unreadable={unreadable}
      errors={errors}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
    </>
  );
}
