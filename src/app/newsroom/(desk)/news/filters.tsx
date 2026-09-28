import Link from "next/link";

import { num } from "@/app/app/format";
import { REGIONS, TAXONOMY } from "@/lib/news/taxonomy";

export type NewsQuery = { tab: string; cat?: string; region?: string; lang?: string; src?: string };

const LANGS: Record<string, string> = { ckb: "کوردی", ku: "کوردی", ar: "عەرەبی", en: "ئینگلیزی", tr: "تورکی" };

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

export function NewsFilters(props: {
  q: NewsQuery;
  categoryCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  langs: string[];
  sources: string[];
}) {
  const { q, categoryCounts, regionCounts, langs, sources } = props;
  const cats = TAXONOMY.filter((c) => categoryCounts[c.id]);
  return (
    <div className="gm-stack" style={{ gap: 8 }}>
      {cats.length > 0 && (
        <div className="gm-chips" aria-label="بابەت">
          <Chip href={newsHref(q, { cat: undefined })} on={!q.cat}>هەموو بابەتەکان</Chip>
          {cats.map((c) => (
            <Chip key={c.id} href={newsHref(q, { cat: q.cat === c.id ? undefined : c.id })} on={q.cat === c.id}>
              {c.label} · {num(categoryCounts[c.id])}
            </Chip>
          ))}
        </div>
      )}
      <div className="gm-chips" aria-label="ناوچە">
        <Chip href={newsHref(q, { region: undefined })} on={!q.region}>هەموو ناوچەکان</Chip>
        {REGIONS.filter((r) => regionCounts[r.id]).map((r) => (
          <Chip key={r.id} href={newsHref(q, { region: q.region === r.id ? undefined : r.id })} on={q.region === r.id}>
            {r.label}
          </Chip>
        ))}
        {langs.length > 1 &&
          langs.map((l) => (
            <Chip key={l} href={newsHref(q, { lang: q.lang === l ? undefined : l })} on={q.lang === l}>
              {LANGS[l] ?? l}
            </Chip>
          ))}
      </div>
      {sources.length > 1 && (
        <div className="gm-chips" aria-label="سەرچاوە">
          <Chip href={newsHref(q, { src: undefined })} on={!q.src}>هەموو سەرچاوەکان</Chip>
          {sources.map((s) => (
            <Chip key={s} href={newsHref(q, { src: q.src === s ? undefined : s })} on={q.src === s}>
              {s}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
