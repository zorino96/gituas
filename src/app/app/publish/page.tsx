import Link from "next/link";

import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { baseFor, currentWorkspace, loadAccountLists, loadConnections } from "../data";
import { PublishClient } from "./publish-client";
import { listScheduled } from "./schedule-actions";

// Instagram video containers are polled for up to ~45 s before publishing.
export const maxDuration = 60;

export default async function PublishPage({ searchParams }: { searchParams: Promise<{ draft?: string; video?: string; to?: string }> }) {
  const t = dict(await getLang());
  const ws = (await currentWorkspace())!;
  if (!can(ws.role, "publish")) {
    return (
      <p className="gm-note">
        {t.publish.notAllowed}
      </p>
    );
  }
  const { draft: draftId, video: videoId, to } = await searchParams;
  // "?to=TT" or "?to=YT": open with only that platform on (the videos list's one-click links).
  const targets = (typeof to === "string" ? to.split(",") : []).filter((x): x is "TT" | "YT" | "FB" | "IG" => ["TT", "YT", "FB", "IG"].includes(x));
  const [lists, conns, draft, products, scheduled, video] = await Promise.all([
    loadAccountLists(ws.id),
    loadConnections(ws.id),
    draftId ? db.newsDraft.findFirst({ where: { id: draftId, tenantId: ws.id }, include: { item: true } }) : null,
    db.product.findMany({ where: { active: true, store: { tenantId: ws.id } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" } }),
    listScheduled(),
    // The draft's own rendered video (src/lib/news/video.ts), posted instead of its card.
    draftId && videoId
      ? db.newsVideo.findFirst({ where: { id: videoId, tenantId: ws.id, draftId, status: { in: ["RENDERED", "POSTING", "POSTED"] } }, select: { videoUrl: true, videoPath: true } })
      : null,
  ]);
  const hasCard = !!(draft?.cardUrl && draft?.cardPath);
  const hasVideo = !!(video?.videoUrl && video.videoPath);
  const initial = draft && (hasCard || hasVideo)
    ? {
        newsDraftId: draft.id,
        caption: `${draft.headline.trim()}\n\n${draft.body.trim()}`,
        media: hasVideo
          ? { url: video!.videoUrl!, pathname: video!.videoPath!, type: "VIDEO" as const }
          : { url: draft.cardUrl!, pathname: draft.cardPath!, type: "IMAGE" as const },
        ...(targets.length ? { targets } : {}),
      }
    : undefined;
  return (
    <>
      {draft && !hasCard && !hasVideo && (
        <p className="gm-note warn" style={{ marginBottom: 12 }}>
          {t.publish.draftStale}{" "}
          <Link href={`${baseFor(ws.kind)}/news/${draft.itemId}`} className="gm-link">{t.common.open}</Link>
        </p>
      )}
      <PublishClient
        workspaceId={ws.id}
        products={products}
        initial={initial}
        scheduled={scheduled}
        accounts={{
          FB: conns.META_FACEBOOK.connected ? (conns.META_FACEBOOK.name ?? t.publish.fbPage) : null,
          IG: conns.META_INSTAGRAM.connected ? (conns.META_INSTAGRAM.name ?? t.platform.IG) : null,
          TT: conns.TIKTOK.connected ? (conns.TIKTOK.name ?? t.platform.TT) : null,
          YT: conns.YOUTUBE.connected ? (conns.YOUTUBE.name ?? t.platform.YT) : null,
        }}
        accountLists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM, TT: lists.TIKTOK, YT: lists.YOUTUBE }}
      />
    </>
  );
}
