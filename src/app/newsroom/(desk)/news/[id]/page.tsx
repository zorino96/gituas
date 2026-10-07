import { notFound, redirect } from "next/navigation";

import { db } from "@/lib/db";
import { brandFrom } from "@/lib/cards/brand";
import { currentWorkspace } from "@/app/app/data";
import { NewsEditor } from "./editor";
import { VideoPanel } from "./video-panel";
import { videoQuotaFor } from "@/lib/billing/plans";
import type { DraftView } from "../actions";
import { CARD_KINDS, type CardKind } from "@/lib/news/types";

export const maxDuration = 60;

export default async function NewsItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ws = (await currentWorkspace())!;
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/newsroom");
  const { id } = await params;
  const [item, kit, tenant] = await Promise.all([
    db.newsItem.findFirst({ where: { id, tenantId: ws.id }, include: { draft: true } }),
    db.brandKit.findUnique({ where: { tenantId: ws.id } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
  ]);
  if (!item) notFound();
  const d = item.draft;
  // The video panel: only on plans with a video quota, once the story has a draft.
  const video =
    d && videoQuotaFor(tenant?.plan) > 0
      ? await db.newsVideo.findFirst({ where: { tenantId: ws.id, draftId: d.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, style: true, videoUrl: true } })
      : undefined;
  const initial: DraftView | null = d
    ? {
        draftId: d.id,
        headline: d.headline,
        body: d.body,
        category: d.category,
        cardKind: (CARD_KINDS.includes(d.cardKind as CardKind) ? d.cardKind : "STANDARD") as CardKind,
        stat: d.stat,
        quote: d.quote,
        speaker: d.speaker,
        photoPath: d.photoPath,
        model: d.model,
      }
    : null;
  return (
    <>
    <NewsEditor
      workspaceId={ws.id}
      source={{
        itemId: item.id,
        sourceName: item.sourceName,
        title: item.title,
        snippet: item.snippet,
        url: item.url,
        publishedAt: item.publishedAt.toISOString(),
      }}
      initial={initial}
      brand={brandFrom(kit, ws.name)}
    />
    {d && video !== undefined && <VideoPanel workspaceId={ws.id} draftId={d.id} initial={video} />}
    </>
  );
}
