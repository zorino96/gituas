import { db } from "@/lib/db";
import { captionFor } from "@/lib/news/rules";
import { currentWorkspace, loadConnections } from "../data";
import { PublishClient } from "./publish-client";

// Instagram video containers are polled for up to ~45 s before publishing.
export const maxDuration = 60;

export default async function PublishPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const ws = (await currentWorkspace())!;
  const { draft: draftId } = await searchParams;
  const [conns, draft] = await Promise.all([
    loadConnections(ws.id),
    draftId ? db.newsDraft.findFirst({ where: { id: draftId, tenantId: ws.id }, include: { item: true } }) : null,
  ]);
  const initial =
    draft?.cardUrl && draft.cardPath
      ? {
          newsDraftId: draft.id,
          caption: captionFor(draft, { name: draft.item.sourceName, url: draft.item.url }),
          media: { url: draft.cardUrl, pathname: draft.cardPath, type: "IMAGE" as const },
        }
      : undefined;
  return (
    <PublishClient
      workspaceId={ws.id}
      initial={initial}
      accounts={{
        FB: conns.META_FACEBOOK.connected ? (conns.META_FACEBOOK.name ?? "پەیجی فەیسبووک") : null,
        IG: conns.META_INSTAGRAM.connected ? (conns.META_INSTAGRAM.name ?? "ئینستاگرام") : null,
        TT: conns.TIKTOK.connected ? (conns.TIKTOK.name ?? "تیکتۆک") : null,
      }}
    />
  );
}
