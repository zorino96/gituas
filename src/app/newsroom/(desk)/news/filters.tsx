import Link from "next/link";

import { num } from "@/app/app/format";
import { dict, getLang } from "@/lib/i18n";
import { REGIONS, TAXONOMY } from "@/lib/news/taxonomy";

export type NewsQuery = { tab: string; cat?: string; region?: string; lang?: string; src?: string };

export function newsHref(q: NewsQuery, change: Partial<NewsQuery>): string {
  const next = { ...q, ...change };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
  return `/newsroom/news?${sp.toString()}`;
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className="gm-chip" aria-pressed={on} scroll={false}>
      {children}
    </Link>
  );
}

export async function NewsFilters(props: {
  q: NewsQuery;
  categoryCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  langs: string[];
  sources: string[];
}) {
  const { q, categoryCounts, regionCounts, langs, sources } = props;
  const tn = dict(await getLang()).nr.news;
  const langNames: Record<string, string> = tn.langs;
  const cats = TAXONOMY.filter((c) => categoryCounts[c.id] || c.id === q.cat);
  // An active filter always stays visible, so it can be cleared.
  const langList = q.lang && !langs.includes(q.lang) ? [...langs, q.lang] : langs;
  const sourceList = q.src && !sources.includes(q.src) ? [...sources, q.src] : sources;
  return (
    <div className="nr-filter-groups">
      {cats.length > 0 && (
        <div className="nr-filter" role="group" aria-labelledby="nf-cat">
          <span id="nf-cat" className="nr-filter-label">{tn.filters.topic}</span>
          <div className="gm-chips">
            <Chip href={newsHref(q, { cat: undefined })} on={!q.cat}>{tn.filters.allTopics}</Chip>
            {cats.map((c) => (
              <Chip key={c.id} href={newsHref(q, { cat: q.cat === c.id ? undefined : c.id })} on={q.cat === c.id}>
                {tn.topics[c.id]} · {num(categoryCounts[c.id])}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <div className="nr-filter" role="group" aria-labelledby="nf-region">
        <span id="nf-region" className="nr-filter-label">{tn.filters.region}</span>
        <div className="gm-chips">
          <Chip href={newsHref(q, { region: undefined })} on={!q.region}>{tn.filters.allRegions}</Chip>
          {REGIONS.filter((r) => regionCounts[r.id] || r.id === q.region).map((r) => (
            <Chip key={r.id} href={newsHref(q, { region: q.region === r.id ? undefined : r.id })} on={q.region === r.id}>
              {tn.regions[r.id]}
            </Chip>
          ))}
          {langList.length > 1 || q.lang ? (
            <>
              {/* languages share the row; a hairline sets them apart from the regions */}
              <span className="nr-filter-sep" aria-hidden="true" />
              {langList.map((l) => (
                <Chip key={l} href={newsHref(q, { lang: q.lang === l ? undefined : l })} on={q.lang === l}>
                  {langNames[l] ?? l}
                </Chip>
              ))}
            </>
          ) : null}
        </div>
      </div>
      {(sourceList.length > 1 || q.src) && (
        <div className="nr-filter" role="group" aria-labelledby="nf-src">
          <span id="nf-src" className="nr-filter-label">{tn.filters.source}</span>
          <div className="gm-chips">
            <Chip href={newsHref(q, { src: undefined })} on={!q.src}>{tn.filters.allSources}</Chip>
            {sourceList.map((s) => (
              <Chip key={s} href={newsHref(q, { src: q.src === s ? undefined : s })} on={q.src === s}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
