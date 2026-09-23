import { currentWorkspace, loadConnections, loadPosts } from "../data";
import { CommentsClient } from "./comments-client";

export default async function CommentsPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const { posts, errors } = await loadPosts(ws.id, conns);
  return (
    <CommentsClient
      initialPosts={posts}
      errors={errors}
      whatsappPath={ws.whatsappNumber ? `/w/${ws.slug}` : null}
      connected={{ FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected }}
    />
  );
}
