import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Newspaper, Rss, Sparkles } from "lucide-react";

import { classifyPending } from "@/lib/news/classify";
import { focusVisible, loadActiveFocus } from "@/lib/news/focus";

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { usageOf } from "@/lib/billing/limits";
import { NEWS_LIMITS, refreshSecFor } from "@/lib/billing/plans";
import { CATALOG } from "@/lib/news/catalog";
import { groupByCluster } from "@/lib/news/cluster";
import { ingest } from "@/lib/news/ingest";
import { dict, getLang } from "@/lib/i18n";
import { categoryLabel, categoryWhere, regionLabel, REGIONS, TAXONOMY } from "@/lib/news/taxonomy";
import { currentWorkspace } from "@/app/app/data";
import { ago } from "@/app/app/format";
import { checklist, checklistDone } from "@/lib/newsroom/checklist";
import { AutoRefresh } from "./auto-refresh";
import { Checklist } from "./checklist";
import { NewsFilters, newsHref, type NewsQuery } from "./filters";
import { RefreshButton } from "./refresh-button";

export const maxDuration = 60;

const INGEST_WAIT_MS = 5000;
/** How much earlier than the plan's interval the page's own refresh may fetch again. */
const REFRESH_GRACE_MS = 5000;

const TABS = [
  { key: "new", statuses: ["NEW"] },
  { key: "ready", statuses: ["DRAFTED"] },
  { key: "done", statuses: ["PUBLISHED"] },
] as const;

/** The story languages the list names; t.nr.news.langs has the words. */
const LIST_LANGS = new Set(["ku", "ar", "en"]);

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; cat?: string; region?: string; lang?: string; src?: string }>;
}) {
  const ws = (await currentWorkspace())!;
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/newsroom");
  const sp = await searchParams;
  const tab = TABS.find((x) => x.key === sp.tab) ?? TABS[0];
  const t = dict(await getLang());
  const tn = t.nr.news;
  const langNames: Record<string, string> = tn.langs;

  // Fetching is throttled to the plan's refresh interval, so opening the desk is cheap.
  // GDELT can take 10–20 s, so the page waits at most INGEST_WAIT_MS and shows
  // what is stored; `after` keeps the function alive until the fetch finishes,
  // and its stories appear on the next open or refresh.
  // The page refreshes itself exactly one interval after the last load, and that load claimed its
  // fetch a moment after it began: without a little grace every second refresh would be refused.
  const fetching = ingest(ws.id, { graceMs: REFRESH_GRACE_MS }).catch(() => null);
  // Classification runs after the response, so neither the page nor a refresh waits on the AI.
  after(() => fetching.then(() => classifyPending(ws.id)));
  const ingestResult = await Promise.race([fetching, new Promise<null>((r) => setTimeout(() => r(null), INGEST_WAIT_MS))]);

  const [settings, focus] = await Promise.all([db.newsSettings.findUnique({ where: { tenantId: ws.id } }), loadActiveFocus(ws.id)]);
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
    AND: [categoryWhere(settings?.categories ?? []) as Prisma.NewsItemWhereInput, ...(focus ? [focusVisible(Date.now())] : [])],
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
    db.newsItem.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      take: 150,
      include: { draft: { select: { id: true, auto: true, cardPath: true } } },
    }),
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
  const refreshSec = refreshSecFor(tenant?.plan);
  const attributions = CATALOG.filter((c) => c.attribution && catalogSources.some((s) => s.catalogId === c.id));
  const steps = checklist({
    pagesConnected,
    logoSet: !!kit?.logoPath,
    keywords: settings?.keywords.length ?? 0,
    rssFeeds,
    cardsMade,
    postsPublished,
  }, tn);
  const categoryCounts: Record<string, number> = Object.fromEntries(
    categoryGroups.filter((g) => g.category).map((g) => [g.category as string, g._count._all]),
  );
  const regionCounts: Record<string, number> = Object.fromEntries(
    regionGroups.filter((g) => g.region).map((g) => [g.region as string, g._count._all]),
  );
  const langs = langGroups.filter((g) => g.lang).map((g) => g.lang as string);
  const sourceNames = sourceGroups.map((g) => g.sourceName);
  // Every story in this tab, before the chip filters: the groups below already count them.
  const tabTotal = categoryGroups.reduce((n, g) => n + g._count._all, 0);
  const showChecklist = !checklistDone(steps);

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">{tn.list.title}</h2>
        <RefreshButton />
      </div>
      <AutoRefresh refreshSec={refreshSec} label={t.billing.features.refresh(refreshSec)} />

      <div className={showChecklist ? "nr-overview has-check" : "nr-overview"}>
        <div className="nr-stats">
          <div className="nr-stat">
            <span className="gm-stat-icon" aria-hidden="true"><Newspaper /></span>
            <div>
              <b>{t.fmt.num(tabTotal)}</b>
              <span>{tn.list.tabs[tab.key]}</span>
            </div>
          </div>
          <div className="nr-stat">
            <span className="gm-stat-icon" aria-hidden="true"><Sparkles /></span>
            <div>
              <b>{t.fmt.num(drafts)} / {t.fmt.num(limit)}</b>
              <span>{tn.list.statDrafts}</span>
            </div>
          </div>
          <div className="nr-stat">
            <span className="gm-stat-icon" aria-hidden="true"><Rss /></span>
            <div>
              <b>{t.fmt.num(sources)}</b>
              <span>{tn.list.statSources}</span>
            </div>
          </div>
        </div>
        {showChecklist && <Checklist steps={steps} />}
      </div>

      <div className="gm-card nr-filters">
        <div className="gm-chips nr-tabs" role="tablist">
          {TABS.map((x) => (
            <Link key={x.key} href={newsHref(q, { tab: x.key })} className="gm-chip" aria-pressed={x.key === tab.key}>
              {tn.list.tabs[x.key]}
            </Link>
          ))}
        </div>

        <NewsFilters q={q} categoryCounts={categoryCounts} regionCounts={regionCounts} langs={langs} sources={sourceNames} />
      </div>

      {!sources && (
        <p className="gm-note">
          {tn.list.noSources} <Link href="/newsroom/settings" className="gm-link">{tn.list.noSourcesLink}</Link>.
        </p>
      )}
      {!!sources && !settings?.keywords.length && (
        <p className="gm-note">
          {tn.list.noKeywords} <Link href="/newsroom/settings" className="gm-link">{tn.list.noKeywordsLink}</Link>.
        </p>
      )}
      {ingestResult?.failed.length ? <p className="gm-hint">{tn.list.noAnswer(ingestResult.failed.join(t.fmt.listSep))}</p> : null}

      {groups.length === 0 ? (
        <p className="gm-empty">{tn.list.empty}</p>
      ) : (
        <div className="nr-news-list">
          {groups.map(({ lead, count }) => {
            // Written (and maybe posted) by the autopilot: marked in the ready and published tabs.
            const auto = tab.key !== "new" && !!lead.draft?.auto;
            const story = (
              <>
                <b dir="auto">{lead.title}</b>
                {auto && <span className="gm-badge ghost nr-auto">{tn.list.auto}</span>}
                <small className="gm-sub">
                  {lead.sourceName}
                  {count > 1 ? ` · ${tn.list.sourceCount(count)}` : ""} · {ago(lead.publishedAt.toISOString(), t)}
                  {lead.lang && LIST_LANGS.has(lead.lang) ? ` · ${langNames[lead.lang]}` : ""}
                  {categoryLabel(lead.category, lead.subcategory, tn) ? ` · ${categoryLabel(lead.category, lead.subcategory, tn)}` : ""}
                  {regionLabel(lead.region, tn) ? ` · ${regionLabel(lead.region, tn)}` : ""}
                </small>
              </>
            );
            // The autopilot never posts to TikTok: a post it made is one tap from the composer, where a person approves it.
            if (auto && tab.key === "done" && lead.draft?.cardPath) {
              return (
                <div key={lead.id} className="gm-card">
                  <Link href={`/newsroom/news/${lead.id}`} className="nr-news-open">{story}</Link>
                  <Link href={`/newsroom/publish?draft=${lead.draft.id}`} className="gm-link nr-news-more">{t.platform.TT}</Link>
                </div>
              );
            }
            return (
              <Link key={lead.id} href={`/newsroom/news/${lead.id}`} className="gm-card">
                {story}
              </Link>
            );
          })}
        </div>
      )}

      {attributions.length > 0 && (
        <p className="gm-hint">
          {tn.list.attribBefore}{" "}
          {attributions.map((a, i) => (
            <span key={a.id}>
              {i > 0 ? tn.list.attribAnd : ""}
              <a href={a.attribution!.url} className="gm-link" target="_blank" rel="noreferrer">{a.attribution!.label}</a>
            </span>
          ))}
          {tn.list.attribAfter}
        </p>
      )}
    </div>
  );
}
