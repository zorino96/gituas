import Link from "next/link";

import { db } from "@/lib/db";
import { attributionFor } from "@/lib/news/rules";
import { baseFor, currentWorkspace, loadConnections } from "../data";
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
  const hasCard = !!(draft?.cardUrl && draft?.cardPath);
  const initial = draft && hasCard
    ? {
        newsDraftId: draft.id,
        caption: `${draft.headline.trim()}\n\n${draft.body.trim()}`,
        media: { url: draft.cardUrl!, pathname: draft.cardPath!, type: "IMAGE" as const },
        attribution: attributionFor({ name: draft.item.sourceName, url: draft.item.url }),
      }
    : undefined;
  return (
    <>
      {draft && !hasCard && (
        <p className="gm-note warn" style={{ marginBottom: 12 }}>
          کارتی ئەم هەواڵە کۆن بووە. لە مێزی هەواڵ دووبارە ئامادەی بکەوە.{" "}
          <Link href={`${baseFor(ws.kind)}/news/${draft.itemId}`} className="gm-link">کردنەوە</Link>
        </p>
      )}
      <PublishClient
        workspaceId={ws.id}
        initial={initial}
        accounts={{
          FB: conns.META_FACEBOOK.connected ? (conns.META_FACEBOOK.name ?? "پەیجی فەیسبووک") : null,
          IG: conns.META_INSTAGRAM.connected ? (conns.META_INSTAGRAM.name ?? "ئینستاگرام") : null,
          TT: conns.TIKTOK.connected ? (conns.TIKTOK.name ?? "تیکتۆک") : null,
        }}
      />
    </>
  );
}
