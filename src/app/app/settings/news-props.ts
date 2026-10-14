// What the newsroom's setup screens show, read once for every one of them (sources, automatic publishing, video, brand).
import { loadVoiceClone } from "@/lib/voice/clone";
import { isFrameText } from "@/lib/cards/brand";
import { db } from "@/lib/db";
import { imageEnabled } from "@/lib/ai/image";
import { canAutoPublish, promptFilterFor, refreshSecFor, videoQuotaFor } from "@/lib/billing/plans";
import { usageOf } from "@/lib/billing/limits";
import { AUTO_DAILY_MAX, AUTO_MIN_GAP, autoTargetsFor, isAutoMode } from "@/lib/news/autopilot-settings";
import { catalogAvailable } from "@/lib/news/catalog";
import type { loadAccountLists, loadConnections } from "../data";
import type { NewsSettingsProps } from "./news-settings";

export async function loadNewsProps(
  ws: { id: string; name: string },
  conns: Awaited<ReturnType<typeof loadConnections>>,
  lists: Awaited<ReturnType<typeof loadAccountLists>>,
): Promise<NewsSettingsProps> {
  const [settings, sources, kit, tenant, frames] = await Promise.all([
    db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
    db.newsSource.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" } }),
    db.brandKit.findUnique({ where: { tenantId: ws.id } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    db.newsFrame.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const canPublish = canAutoPublish(tenant?.plan);
  const savedMode = isAutoMode(settings?.autoMode) ? settings.autoMode : "OFF";
  return {
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
    sourceImages: settings?.sourceImages ?? false,
    aiPictures: settings?.aiPictures ?? false,
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
      clone: await (async () => {
        if (tenant?.plan !== "ENTERPRISE") return { saved: false, text: "", seconds: 0 };
        const c = await loadVoiceClone(ws.id);
        return { saved: !!c, text: c?.text ?? "", seconds: c?.seconds ?? 0 };
      })(),
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
    sectionFrames: frames.map((f) => ({
      section: f.section,
      framePath: f.framePath,
      frameText: isFrameText(f.frameText) ? f.frameText : "bottom",
      referencePath: f.referencePath,
      note: f.note ?? "",
    })),
    designPrompt: settings?.designPrompt ?? "",
    aiFrames: imageEnabled(),
    photos: await db.newsPhoto.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "desc" }, select: { id: true, pathname: true, label: true, general: true } }),
  };
}
