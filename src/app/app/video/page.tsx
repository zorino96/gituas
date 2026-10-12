import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { aiFor } from "@/lib/ai/for-store";
import { allowanceOf } from "@/lib/ai/meter";
import { VIDEOS_PER_DAY, videosToday } from "@/lib/advideo/limits";
import { allowances } from "@/lib/advideo/prepare";
import { listRefs, REF_LIMITS } from "@/lib/advideo/refs";
import { postIdsOf } from "@/lib/advideo/signals";
import type { AdLook } from "@/lib/advideo/spec";
import { loadMarketNotes, readTodaysBrief } from "@/lib/advideo/strategy";
import { ordersByPost } from "@/lib/orders/audience";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import type { StorePlan } from "@/lib/shop/plans";
import { loadShopState } from "@/lib/shop/state";
import { loadConnections, requireWorkspace } from "../data";
import { ownerJobError } from "@/lib/advideo/job-error";
import { VideoClient, type VideoJobView } from "./video-client";

export const dynamic = "force-dynamic";
// Starting a video runs its script and voice after the answer is sent (next/server after()); this is the room it has.
export const maxDuration = 60;

export default async function VideoPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const ws = await requireWorkspace();
  if (!adVideoEnabled() || ws.kind !== "MERCHANT") redirect("/app");
  const t = dict(await getLang());
  if (!can(ws.role, "publish")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const sp = await searchParams;
  const conns = await loadConnections(ws.id);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const state = await loadShopState(ws.id, sp.store, connectedIds);
  if (!state.store) {
    return (
      <div className="gm-empty">
        <b className="kufi">{t.automation.noPageTitle}</b>
        {t.automation.noPageBody}{" "}
        <Link href="/app/settings" className="gm-link">
          {t.automation.settingsLink}
        </Link>
      </div>
    );
  }
  const { store } = state;
  const [jobs, allow, refs, plan, notes, aiState] = await Promise.all([
    db.adVideo.findMany({ where: { tenantId: ws.id, storeId: store.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    allowances(ws.id),
    listRefs(ws.id, store.id),
    readTodaysBrief(ws.id, store.id),
    loadMarketNotes(ws.id, store.id),
    allowanceOf(aiFor({ tenantId: ws.id }).meter),
  ]);
  const productName = new Map(state.products.map((p) => [p.id, p.name]));

  // How the posted videos did: the comments and the orders that came from their posts.
  const idsOf = new Map(jobs.filter((j) => j.postedAt).map((j) => [j.id, postIdsOf(j.results)]));
  const allIds = [...new Set([...idsOf.values()].flat())];
  const commentsBy = new Map<string, number>();
  let ordersBy: Record<string, number> = {};
  if (allIds.length) {
    try {
      const rows = await db.conversationMessage.groupBy({
        by: ["externalThreadId"],
        where: { storeId: store.id, channelType: "COMMENT", externalThreadId: { in: allIds } },
        _count: { _all: true },
      });
      for (const r of rows) if (r.externalThreadId) commentsBy.set(r.externalThreadId, r._count._all);
      ordersBy = await ordersByPost(ws.id, allIds);
    } catch {
      /* the counts are a bonus */
    }
  }

  const views: VideoJobView[] = jobs.map((j) => {
    const spec = (j.spec ?? {}) as { look?: AdLook; plan?: { objective?: string; why?: string } };
    const ids = idsOf.get(j.id) ?? [];
    return {
    id: j.id,
    tier: j.tier === "PRO" ? "PRO" : "LITE",
    status: j.status,
    source: j.source,
    topic: j.topic,
    productName: j.productId ? productName.get(j.productId) ?? null : null,
    caption: j.caption,
    videoUrl: j.status === "RENDERED" || j.status === "POSTING" || j.status === "POSTED" ? j.videoUrl : null,
    error: ownerJobError(j.status, j.error, t.video.errors),
    createdAt: j.createdAt.toISOString(),
    postedAt: j.postedAt ? j.postedAt.toISOString() : null,
    objective: spec.plan?.objective ?? null,
    why: spec.plan?.why ?? null,
    look: spec.look ? `${spec.look.palette} · ${spec.look.background} · ${spec.look.layout}` : null,
    comments: ids.length ? ids.reduce((n, id) => n + (commentsBy.get(id) ?? 0), 0) : null,
    orders: ids.length ? ids.reduce((n, id) => n + (ordersBy[id] ?? 0), 0) : null,
    };
  });

  return (
    <VideoClient
      key={store.id}
      storeId={store.id}
      stores={state.stores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "—") }))}
      canFb={!!store.fbPageId}
      canIg={!!store.igUserId}
      products={state.products.map((p) => ({ id: p.id, name: p.name, hasPhoto: p.photos.length > 0 }))}
      allowances={{ LITE: allow.LITE, PRO: allow.PRO }}
      auto={{ mode: store.videoAutoMode, tier: store.videoAutoTier === "PRO" ? "PRO" : "LITE", hour: store.videoAutoHour }}
      jobs={views}
      configure={can(ws.role, "configure")}
      workspaceId={ws.id}
      today={allow.today}
      aiPercent={aiState.percent}
      refs={refs.map((x) => ({ pathname: x.pathname, url: x.url, kind: x.kind, name: x.name, size: x.size }))}
      refLimits={{ images: REF_LIMITS.images, videos: REF_LIMITS.videos, imageMb: REF_LIMITS.imageBytes / 1048576, videoMb: REF_LIMITS.videoBytes / 1048576 }}
      plan={
        plan
          ? {
              objective: plan.objective,
              why: plan.why,
              format: plan.format,
              priceMode: plan.priceMode,
              cta: plan.cta,
              urgent: plan.urgent,
              product: plan.productId ? productName.get(plan.productId) ?? null : null,
              boost: plan.boost,
              source: plan.source,
            }
          : null
      }
      notes={notes}
    />
  );
}
