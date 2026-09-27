import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { db } from "@/lib/db";
import { usageOf } from "@/lib/billing/limits";
import { NEWS_LIMITS } from "@/lib/billing/plans";
import { CATALOG } from "@/lib/news/catalog";
import { groupByCluster } from "@/lib/news/cluster";
import { ingest } from "@/lib/news/ingest";
import { currentWorkspace } from "@/app/app/data";
import { ago, num } from "@/app/app/format";
import { RefreshButton } from "./refresh-button";

export const maxDuration = 60;

const INGEST_WAIT_MS = 5000;

const TABS = [
  { key: "new", label: "نوێ", statuses: ["NEW"] },
  { key: "ready", label: "ئامادە", statuses: ["DRAFTED"] },
  { key: "done", label: "بڵاوکراوە", statuses: ["PUBLISHED"] },
] as const;

const LANG_LABEL: Record<string, string> = { ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی" };

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ws = (await currentWorkspace())!;
  if (ws.kindChosen && ws.kind !== "NEWS") redirect("/newsroom");
  const { tab: tabKey } = await searchParams;
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];

  // Fetching is throttled to once per five minutes, so opening the desk is cheap.
  // GDELT can take 10–20 s, so the page waits at most INGEST_WAIT_MS and shows
  // what is stored; `after` keeps the function alive until the fetch finishes,
  // and its stories appear on the next open or refresh.
  const fetching = ingest(ws.id).catch(() => null);
  after(() => fetching);
  const ingestResult = await Promise.race([fetching, new Promise<null>((r) => setTimeout(() => r(null), INGEST_WAIT_MS))]);
  const [items, sources, settings, tenant, drafts, catalogSources] = await Promise.all([
    db.newsItem.findMany({
      where: { tenantId: ws.id, status: { in: [...tab.statuses] } },
      orderBy: { publishedAt: "desc" },
      take: 150,
    }),
    db.newsSource.count({ where: { tenantId: ws.id, enabled: true } }),
    db.newsSettings.findUnique({ where: { tenantId: ws.id } }),
    db.tenant.findUnique({ where: { id: ws.id }, select: { plan: true } }),
    usageOf(ws.id, "draft"),
    db.newsSource.findMany({ where: { tenantId: ws.id, enabled: true, catalogId: { not: null } }, select: { catalogId: true } }),
  ]);
  const groups = groupByCluster(items);
  const limit = NEWS_LIMITS[tenant?.plan ?? "MANUAL"].draft;
  const attributions = CATALOG.filter((c) => catalogSources.some((s) => s.catalogId === c.id));

  return (
    <div className="gm-stack">
      <div className="gm-between">
        <h2 className="gm-title kufi">هەواڵەکان</h2>
        <RefreshButton />
      </div>

      <div className="gm-chips" role="tablist">
        {TABS.map((t) => (
          <Link key={t.key} href={`/newsroom/news?tab=${t.key}`} className="gm-chip" aria-pressed={t.key === tab.key}>
            {t.label}
          </Link>
        ))}
      </div>

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
                <a href={a.attribution.url} className="gm-link" target="_blank" rel="noreferrer">{a.attribution.label}</a>
              </span>
            ))}
            ەوە دێن.
          </>
        )}
      </p>
    </div>
  );
}
