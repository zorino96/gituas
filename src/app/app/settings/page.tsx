import { auth } from "@/auth";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { catalogAvailable } from "@/lib/news/catalog";
import { currentWorkspace, loadConnections } from "../data";
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
  const [conns, me] = await Promise.all([
    loadConnections(ws.id),
    db.user.findUnique({ where: { id: session!.user!.id! }, select: { email: true, passwordHash: true } }),
  ]);

  let news: NewsSettingsProps | null = null;
  if (ws.kind === "NEWS") {
    const [settings, sources, kit] = await Promise.all([
      db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
      db.newsSource.findMany({ where: { tenantId: ws.id }, orderBy: { createdAt: "asc" } }),
      db.brandKit.findUnique({ where: { tenantId: ws.id } }),
    ]);
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
      voiceNote: settings?.voiceNote ?? "",
      feeds: sources.filter((s) => s.rssUrl && !s.catalogId).map((s) => ({ id: s.id, name: s.name, url: s.rssUrl!, lastError: s.lastError })),
      kit: {
        logoPath: kit?.logoPath ?? null,
        primary: kit?.primary ?? "#0B2545",
        accent: kit?.accent ?? "#E0A526",
        text: kit?.text ?? "#FFFFFF",
        headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
      },
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
        { provider: "META_FACEBOOK", label: t.platform.FB, note: t.settings.connNote.META_FACEBOOK, ...conns.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: t.platform.IG, note: t.settings.connNote.META_INSTAGRAM, ...conns.META_INSTAGRAM },
        { provider: "TIKTOK", label: t.platform.TT, note: t.settings.connNote.TIKTOK, ...conns.TIKTOK },
        { provider: "YOUTUBE", label: t.platform.YT, note: t.settings.connNote.YOUTUBE, ...conns.YOUTUBE },
      ]}
    />
  );
}
