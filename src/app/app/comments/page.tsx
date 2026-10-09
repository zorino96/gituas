import { loadCommentOutcomes } from "@/lib/shop/state";
import { withAccounts } from "@/lib/oauth/account-scope";
import { AccountSwitcher } from "../account-switcher";
import { accountChoiceFrom, currentWorkspace, loadConnections, loadPosts } from "../data";
import { CommentsClient } from "./comments-client";

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ fb?: string; ig?: string }> }) {
  const ws = (await currentWorkspace())!;
  const { choice, lists } = await accountChoiceFrom(ws.id, await searchParams);
  // Everything below reads the chosen Page / Instagram account (or the default one).
  const { conns, posts, errors } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    return { conns, ...(await loadPosts(ws.id, conns)) };
  });
  // What the shop automation did with each comment, replies included. Workspaces without a store get {}.
  const outcomes = await loadCommentOutcomes(
    ws.id,
    posts.flatMap((p) => p.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)])),
  );
  return (
    <>
    <AccountSwitcher lists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM }} selected={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }} />
    <CommentsClient
      accounts={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }}
      initialPosts={posts}
      errors={errors}
      outcomes={outcomes}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
    </>
  );
}
