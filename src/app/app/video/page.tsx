import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { allowances } from "@/lib/advideo/prepare";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import type { StorePlan } from "@/lib/shop/plans";
import { loadShopState } from "@/lib/shop/state";
import { loadConnections, requireWorkspace } from "../data";
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
  const [jobs, allow] = await Promise.all([
    db.adVideo.findMany({ where: { tenantId: ws.id, storeId: store.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    allowances(store.id, store.plan as StorePlan),
  ]);
  const productName = new Map(state.products.map((p) => [p.id, p.name]));

  const views: VideoJobView[] = jobs.map((j) => ({
    id: j.id,
    tier: j.tier === "PRO" ? "PRO" : "LITE",
    status: j.status,
    source: j.source,
    topic: j.topic,
    productName: j.productId ? productName.get(j.productId) ?? null : null,
    caption: j.caption,
    videoUrl: j.status === "RENDERED" || j.status === "POSTING" || j.status === "POSTED" ? j.videoUrl : null,
    error: j.error,
    createdAt: j.createdAt.toISOString(),
    postedAt: j.postedAt ? j.postedAt.toISOString() : null,
  }));

  return (
    <VideoClient
      key={store.id}
      storeId={store.id}
      stores={state.stores.map((s) => ({ id: s.id, name: s.name || (s.igUsername ? `@${s.igUsername}` : "—") }))}
      canFb={!!store.fbPageId}
      canIg={!!store.igUserId}
      products={state.products.map((p) => ({ id: p.id, name: p.name, hasPhoto: p.photos.length > 0 }))}
      allowances={allow}
      auto={{ mode: store.videoAutoMode, tier: store.videoAutoTier === "PRO" ? "PRO" : "LITE", hour: store.videoAutoHour }}
      jobs={views}
      configure={can(ws.role, "configure")}
    />
  );
}
