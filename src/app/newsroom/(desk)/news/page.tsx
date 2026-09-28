import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { classifyPending } from "@/lib/news/classify";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { usageOf } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { CATALOG } from "@/lib/news/catalog";
import { groupByCluster } from "@/lib/news/cluster";
import { ingest } from "@/lib/news/ingest";
import { categoryLabel, categoryWhere, regionLabel, REGIONS, TAXONOMY } from "@/lib/news/taxonomy";
import { currentWorkspace } from "@/app/app/data";
import { ago, num } from "@/app/app/format";
import { checklist, checklistDone } from "@/lib/newsroom/checklist";
import { Checklist } from "./checklist";
import { NewsFilters, newsHref, type NewsQuery } from "./filters";
import { RefreshButton } from "./refresh-button";

export const maxDuration = 60;

const INGEST_WAIT_MS = 5000;

const TABS = [
  { key: "new", label: "نوێ", statuses: ["NEW"] },
  { key: "ready", label: "ئامادە", statuses: ["DRAFTED"] },
  { key: "done", label: "بڵاوکراوە", statuses: ["PUBLISHED"] },
] as const;

const LANG_LABEL: Record<string, string> = { ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی" };

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cat?: string; region?: string; lang?: string; src?: string }>;
}) {
  const ws = (await currentWorkspace())!;
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/newsroom");
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];

  // Fetching is throttled to once per five minutes, so opening the desk is cheap.
  // GDELT can take 10–20 s, so the page waits at most INGEST_WAIT_MS and shows
  // what is stored; `after` keeps the function alive until the fetch finishes,
  // and its stories appear on the next open or refresh.
  const fetching = ingest(ws.id).catch(() => null);
  // Classification runs after the response, so neither the page nor a refresh waits on the AI.
  after(() => fetching.then(() => classifyPending(ws.id)));
  const ingestResult = await Promise.race([fetching, new Promise<null>((r) => setTimeout(() => r(null), INGEST_WAIT_MS))]);

  const settings = await db.newsSettings.findUnique({ where: { tenantId: ws.id } });
  // Only single string values, and only known category/region ids (a repeated or odd param must not break the page).
  const one = (v: unknown) => (typeof v === "string" && v ? v.slice(0, 120) : undefined);
  const q: NewsQuery = {
    tab: tab.key,
    cat: TAXONOMY.some((c) => c.id === sp.cat) ? one(sp.cat) : undefined,
    region: REGIONS.some((r) => r.id === sp.region) ? one(sp.region) : undefined,
    lang: one(sp.lang),
    src: one(sp.src),
  };
  const base: Prisma.NewsItemWhereInput = {
    tenantId: ws.id,
    status: { in: [...tab.statuses] },
    AND: [categoryWhere(settings?.categories ?? []) as Prisma.NewsItemWhereInput],
  };
  const where: Prisma.NewsItemWhereInput = {
    ...base,
    ...(q.cat ? { category: q.cat } : {}),
    ...(q.region ? { region: q.region } : {}),
    ...(q.lang ? { lang: q.lang } : {}),
    ...(q.src ? { sourceName: q.src } : {}),
  };

  const [
    items,
    sources,
    tenant,
    drafts,
    catalogSources,
    pagesConnected,
    rssFeeds,
    kit,
    cardsMade,
    postsPublished,
    categoryGroups,
    regionGroups,
    langGroups,
    sourceGroups,
  ] = await Promise.all([
    db.newsItem.findMany({ where, orderBy: { publishedAt: "desc" }, take: 150 }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    usageOf(ws.id, "draft"),
    db.newsSource.findMany({ where: { tenantId: ws.id, enabled: true, catalogId: { not: null } }, select: { catalogId: true } }),
    db.oAuthCredential.count({ where: { tenantId: ws.id, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK"] } } }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true, OR: [{ rssUrl: { not: null } }, { catalogId: { notIn: ["gdelt", "newsdata"] } }] } }),
    db.brandKit.findUnique({ where: { tenantId: ws.id }, select: { logoPath: true } }),
    db.newsDraft.count({ where: { tenantId: ws.id, cardPath: { not: null } } }),
    db.newsDraft.count({ where: { tenantId: ws.id, publishedAt: { not: null } } }),
    db.newsItem.groupBy({ by: ["category"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["region"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["lang"], where: base, _count: { _all: true } }),
    db.newsItem.groupBy({ by: ["sourceName"], where: base, _count: { _all: true }, orderBy: { _count: { sourceName: "desc" } }, take: 12 }),
  ]);
  const groups = groupByCluster(items);
  const limit = NEWS_LIMITS[tenant?.plan ?? "MANUAL"].draft;
  const attributions = CATALOG.filter((c) => c.attribution && catalogSources.some((s) => s.catalogId === c.id));
  const steps = checklist({
    pagesConnected,
    logoSet: !!kit?.logoPath,
    keywords: settings?.keywords.length ?? 0,
    rssFeeds,
    cardsMade,
    postsPublished,
  });
  const categoryCounts: Record<string, number> = Object.fromEntries(
    categoryGroups.filter((g) => g.category).map((g) => [g.category as string, g._count._all]),
  );
  const regionCounts: Record<string, number> = Object.fromEntries(
    regionGroups.filter((g) => g.region).map((g) => [g.region as string, g._count._all]),
  );
  const langs = langGroups.filter((g) => g.lang).map((g) => g.lang as string);
  const sourceNames = sourceGroups.map((g) => g.sourceName);

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">هەواڵەکان</h2>
        <RefreshButton />
      </div>

      {!checklistDone(steps) && <Checklist steps={steps} />}

      <div className="gm-chips" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={newsHref(q, { tab: t.key })} className="gm-chip" aria-pressed={t.key === tab.key}>
            {t.label}
          </Link>
        ))}
      </div>

      <NewsFilters q={q} categoryCounts={categoryCounts} regionCounts={regionCounts} langs={langs} sources={sourceNames} />

      {!sources && (
        <p className="gm-note">
          هیچ سەرچاوەیەکت چالاک نییە. <Link href="/newsroom/settings" className="gm-link">لە ڕێکخستن سەرچاوە زیاد بکە</Link>.
        </p>
      )}
      {!!sources && !settings?.keywords.length && (
        <p className="gm-note">
          GDELT و NewsData وشەی سەرەکییان دەوێت. <Link href="/newsroom/settings" className="gm-link">وشە سەرەکییەکانت دابنێ</Link>.
        </p>
      )}
      {ingestResult?.failed.length ? <p className="gm-hint">وەڵامی نەدایەوە: {ingestResult.failed.join("، ")}</p> : null}

      {groups.length === 0 ? (
        <p className="gm-empty">هیچ هەواڵێک لێرە نییە.</p>
      ) : (
        <div className="gm-stack" style={{ gap: 8 }}>
          {groups.map(({ lead, count }) => (
            <Link key={lead.id} href={`/newsroom/news/${lead.id}`} className="gm-card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
              <b dir="auto" style={{ display: "block", lineHeight: 1.7 }}>{lead.title}</b>
              <small className="gm-sub">
                {lead.sourceName}
                {count > 1 ? ` · ${num(count)} سەرچاوە` : ""} · {ago(lead.publishedAt.toISOString())}
                {lead.lang && LANG_LABEL[lead.lang] ? ` · ${LANG_LABEL[lead.lang]}` : ""}
                {categoryLabel(lead.category, lead.subcategory) ? ` · ${categoryLabel(lead.category, lead.subcategory)}` : ""}
                {regionLabel(lead.region) ? ` · ${regionLabel(lead.region)}` : ""}
              </small>
            </Link>
          ))}
        </div>
      )}

      <p className="gm-hint">
        ئامادەکراوی ئەم مانگە: {num(drafts)} / {num(limit)}
        {attributions.length > 0 && (
          <>
            {" "}· هەندێک هەواڵ لە ڕێگەی{" "}
            {attributions.map((a, i) => (
              <span key={a.id}>
                {i > 0 ? " و " : ""}
                <a href={a.attribution!.url} className="gm-link" target="_blank" rel="noreferrer">{a.attribution!.label}</a>
              </span>
            ))}
            ەوە دێن.
          </>
        )}
      </p>
    </div>
  );
}
