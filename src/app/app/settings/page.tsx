import { auth } from "@/auth";
import { db } from "@/lib/db";
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
        return { id: c.id, name: c.name, description: c.description, enabled: !!s?.enabled, lastError: s?.lastError ?? null };
      }),
      feeds: sources.filter((s) => s.rssUrl).map((s) => ({ id: s.id, name: s.name, url: s.rssUrl!, lastError: s.lastError })),
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
      kind={ws.kind}
      news={news}
      connections={[
        { provider: "META_FACEBOOK", label: "فەیسبووک", note: "کۆمێنت، مەسنجەر، بڵاوکردنەوە و ئامار", ...conns.META_FACEBOOK },
        { provider: "META_INSTAGRAM", label: "ئینستاگرام", note: "کۆمێنت، دایرێکت، بڵاوکردنەوە و ئامار", ...conns.META_INSTAGRAM },
        { provider: "TIKTOK", label: "تیکتۆک", note: "بڵاوکردنەوەی ڤیدیۆ و وێنە", ...conns.TIKTOK },
      ]}
    />
  );
}
