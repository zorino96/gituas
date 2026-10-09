import { auth } from "@/auth";
import { isFrameText } from "@/lib/cards/brand";
import { db } from "@/lib/db";
import { canAutoPublish, promptFilterFor, refreshSecFor, videoQuotaFor } from "@/lib/billing/plans";
import { usageOf } from "@/lib/billing/limits";
import { dict, getLang } from "@/lib/i18n";
import { AUTO_DAILY_MAX, AUTO_MIN_GAP, autoTargetsFor, isAutoMode } from "@/lib/news/autopilot-settings";
import { catalogAvailable } from "@/lib/news/catalog";
import { currentWorkspace, loadAccountLists, loadConnections } from "../data";
import { SettingsClient } from "./settings-client";
import type { NewsSettingsProps } from "./news-settings";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const t = dict(await getLang());
  const ws = (await currentWorkspace())!;
  const session = await auth();
  const [conns, lists, me] = await Promise.all([
    loadConnections(ws.id),
    loadAccountLists(ws.id),
    db.user.findUnique({ where: { id: session!.user!.id! }, select: { email: true, passwordHash: true } }),
  ]);

  let news: NewsSettingsProps | null = null;
  if (ws.kind === "NEWS") {
    const [settings, sources, kit, tenant] = await Promise.all([
      db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
      db.newsSource.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" } }),
      db.brandKit.findUnique({ where: { tenantId: ws.id } }),
      db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    ]);
    const canPublish = canAutoPublish(tenant?.plan);
    const savedMode = isAutoMode(settings?.autoMode) ? settings.autoMode : "OFF";
    news = {
      workspaceId: ws.id,
      pageName: ws.name,
      keywords: settings?.keywords ?? [],
      catalog: catalogAvailable().map((c) => {
        const s = sources.find((x) => x.catalogId === c.id);
        return {
          id: c.id,
          name: c.name,
          group: c.group,
          lang: c.lang,
          description: c.description ?? null,
          enabled: !!s?.enabled,
          lastError: s?.lastError ?? null,
        };
      }),
      categories: settings?.categories ?? [],
      keywordFilter: settings?.keywordFilter ?? false,
      video: {
        quota: videoQuotaFor(tenant?.plan),
        used: await usageOf(ws.id, "video"),
        full: tenant?.plan === "ENTERPRISE",
        mode: settings?.videoMode === "AUTO" ? "AUTO" : "OFF",
        style: settings?.videoStyle === "HIGHLIGHT" ? "HIGHLIGHT" : "TEMPLATE",
        clips: await db.newsClip.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "desc" }, select: { id: true, url: true, label: true, general: true } }),
        topics: settings?.videoTopics ?? [],
        dailyMax: settings?.videoDailyMax ?? 5,
        voice: settings?.videoVoice ?? "male",
        speed: settings?.videoSpeed ?? 1,
        prompt: settings?.videoPrompt ?? "",
      },
      filter: {
        level: promptFilterFor(tenant?.plan),
        mode: settings?.filterMode === "PROMPT" ? "PROMPT" : "KEYWORDS",
        focus: settings?.focusPrompt ?? "",
        exclude: settings?.excludePrompt ?? "",
        broad: settings?.focusBroad ?? false,
      },
      voiceNote: settings?.voiceNote ?? "",
      autopilot: {
        // What is shown is what runs: on a plan that may not post by itself, PUBLISH runs as DRAFT.
        mode: savedMode === "PUBLISH" && !canPublish ? "DRAFT" : savedMode,
        targets: autoTargetsFor(settings?.autoTargets, { FB: true, IG: true }),
        dailyMax: settings?.autoDailyMax ?? AUTO_DAILY_MAX.fallback,
        minGapMin: settings?.autoMinGapMin ?? AUTO_MIN_GAP.fallback,
        quietFrom: settings?.autoQuietFrom ?? null,
        quietTo: settings?.autoQuietTo ?? null,
        canPublish,
        refreshSec: refreshSecFor(tenant?.plan),
        connected: { FB: conns.META_FACEBOOK.connected, IG: conns.META_INSTAGRAM.connected },
        accountLists: { FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM },
        accounts: settings?.autoAccounts ?? [],
      },
      feeds: sources.filter((s) => s.rssUrl && !s.catalogId).map((s) => ({ id: s.id, name: s.name, url: s.rssUrl!, lastError: s.lastError })),
      kit: {
        logoPath: kit?.logoPath ?? null,
        primary: kit?.primary ?? "#0B2545",
        accent: kit?.accent ?? "#E0A526",
        text: kit?.text ?? "#FFFFFF",
        headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
        framePath: kit?.framePath ?? null,
        frameText: isFrameText(kit?.frameText) ? kit.frameText : "bottom",
      },
      photos: await db.newsPhoto.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "desc" }, select: { id: true, pathname: true, label: true, general: true } }),
    };
  }

  return (
    <SettingsClient
      slug={ws.slug}
      whatsappNumber={ws.whatsappNumber}
      connected={sp.connected}
      connectError={sp.error}
      account={{ email: me?.email ?? null, hasPassword: !!me?.passwordHash }}
      news={news}
      connections={[
        { provider: "META_FACEBOOK", label: t.platform.FB, note: t.settings.connNote.META_FACEBOOK, ...conns.META_FACEBOOK, accounts: lists.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: t.platform.IG, note: t.settings.connNote.META_INSTAGRAM, ...conns.META_INSTAGRAM, accounts: lists.META_INSTAGRAM },
        { provider: "TIKTOK", label: t.platform.TT, note: t.settings.connNote.TIKTOK, ...conns.TIKTOK, accounts: lists.TIKTOK },
        { provider: "YOUTUBE", label: t.platform.YT, note: t.settings.connNote.YOUTUBE, ...conns.YOUTUBE, accounts: lists.YOUTUBE },
      ]}
    />
  );
}
