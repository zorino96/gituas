import { loadCommentOutcomes } from "@/lib/shop/state";
import { currentWorkspace, loadConnections, loadPosts } from "../data";
import { CommentsClient } from "./comments-client";

export default async function CommentsPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const { posts, errors } = await loadPosts(ws.id, conns);
  // What the shop automation did with each comment, replies included. Workspaces without a store get {}.
  const outcomes = await loadCommentOutcomes(
    ws.id,
    posts.flatMap((p) => p.comments.flatMap((c) => [c.id, ...c.replies.map((r) => r.id)])),
  );
  return (
    <CommentsClient
      initialPosts={posts}
      errors={errors}
      outcomes={outcomes}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
  );
}
