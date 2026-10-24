import { storeChoices } from "@/lib/shop/store-labels";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { aiFor } from "@/lib/ai/for-store";
import { allowanceOf } from "@/lib/ai/meter";
import { isVideoDue } from "@/lib/advideo/auto";
import { creditsOf } from "@/lib/advideo/credits";
import { parseVideoAutoPlan } from "@/lib/advideo/plan";
import { ownerWaitNote } from "@/lib/advideo/wait-note";
import { kindForGoal, langAndKindOf, videoLangOf } from "@/lib/advideo/lang";
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
import { loadProfile } from "@/lib/shop/profile";
import { loadShopState } from "@/lib/shop/state";
import { providersFor } from "@/lib/voice/tts";
import { loadConnections, requireWorkspace } from "../data";
import { ownerJobError } from "@/lib/advideo/job-error";
import { autoHold } from "./hold";
import { subjectViewOf } from "./story-form";
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
  // With no shop chosen the page opens on the shop of the newest video: that is where the owner is looking for it.
  let wanted = sp.store;
  if (!wanted) {
    const latest = await db.adVideo.findFirst({ where: { tenantId: ws.id, storeId: { not: null } }, orderBy: { createdAt: "desc" }, select: { storeId: true } });
    wanted = latest?.storeId ?? undefined;
  }
  const state = await loadShopState(ws.id, wanted, connectedIds);
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
  const [jobs, allow, refs, plan, notes, aiState, profile] = await Promise.all([
    db.adVideo.findMany({ where: { tenantId: ws.id, storeId: store.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    allowances(ws.id),
    listRefs(ws.id, store.id),
    readTodaysBrief(ws.id, store.id),
    loadMarketNotes(ws.id, store.id),
    allowanceOf(aiFor({ tenantId: ws.id }).meter),
    // What the page is for (it never throws): a page that grows or earns from its content opens on a story, the others on an ad.
    loadProfile(store.id),
  ]);
  const productName = new Map(state.products.map((p) => [p.id, p.name]));
  const storeLang = videoLangOf(store.videoLang);
  // Why the daily video has made nothing today, when it is late (nothing is stored about a skipped day: this reads the same limits the engine does).
  const hold = autoHold({
    mode: store.videoAutoMode,
    tier: store.videoAutoTier === "PRO" ? "PRO" : "LITE",
    due: isVideoDue(store, Date.now()),
    paused: !!store.pausedReason,
    hasVoice: storeLang === "ckb" || providersFor(storeLang).length > 0,
    allowances: { LITE: allow.LITE, PRO: allow.PRO },
    today: allow.today,
    // The daily video is optional work: it stops at the optional share of the allowance (the engine's own gate), not at 100 %.
    aiPercent: aiState.optionalPercent,
  });

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
    const spec = (j.spec ?? {}) as { look?: AdLook; plan?: { objective?: string; why?: string }; noPhotos?: boolean; format?: unknown; subject?: { kind?: unknown } };
    // A story about a real case: what it tells and the article it is told from (only when it was really read), whether Gituas chose it, whether it was told
    // from memory or is very recent, the photographs' credits, and whether the owner switched the photographs off.
    const credits = creditsOf(j.spec);
    const { subject, subjectUrl, chosen, fromMemory, recent } = subjectViewOf(j.spec);
    // Why a story that was to be posted by itself waited as a draft (kept as a note on the job; shown only while it still waits).
    const waited = j.status === "RENDERED" ? ownerWaitNote(j.error, { memory: t.video.waitMemory, recent: t.video.waitRecent, fiction: t.video.waitFiction }) : null;
    const ids = idsOf.get(j.id) ?? [];
    const { lang, kind } = langAndKindOf(j.spec);
    return {
    id: j.id,
    tier: j.tier === "PRO" ? "PRO" : "LITE",
    status: j.status,
    lang,
    kind,
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
    ...(credits.length ? { credits: credits.map((c) => ({ title: c.title, author: c.author, licence: c.licence, page: c.page })) } : {}),
    ...(spec.noPhotos === true ? { noPhotos: true } : {}),
    ...(spec.subject?.kind === "fiction" ? { fiction: true } : {}),
    ...(subject ? { subject } : {}),
    // The source link only for a story whose article was really read (a story told from memory has none).
    ...(subjectUrl ? { subjectUrl } : {}),
    ...(chosen ? { subjectChosen: true } : {}),
    // A story told from memory (its Wikipedia article could not be read): the card says so and shows no source link.
    ...(fromMemory ? { fromMemory: true } : {}),
    // A story about a very recent case: the card says to check every fact.
    ...(recent ? { recent: true } : {}),
    ...(waited ? { waited } : {}),
    // A story made wide (16:9, for YouTube): the card shows it in its own shape (an ad and a vertical story carry nothing).
    ...(kind === "story" && spec.format === "wide" ? { format: "wide" as const } : {}),
    };
  });

  return (
    <VideoClient
      key={store.id}
      storeId={store.id}
      stores={await storeChoices(ws.id, state.stores, state.store.id)}
      canFb={!!store.fbPageId}
      canIg={!!store.igUserId}
      products={state.products.map((p) => ({ id: p.id, name: p.name, hasPhoto: p.photos.length > 0 }))}
      allowances={{ LITE: allow.LITE, PRO: allow.PRO }}
      auto={{ mode: store.videoAutoMode, tier: store.videoAutoTier === "PRO" ? "PRO" : "LITE", hour: store.videoAutoHour, lang: storeLang }}
      dailyPlan={parseVideoAutoPlan((store as { videoAutoPlan?: unknown }).videoAutoPlan)}
      autoHold={hold}
      defaultLang={storeLang}
      defaultKind={kindForGoal(profile?.goal ?? null)}
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
