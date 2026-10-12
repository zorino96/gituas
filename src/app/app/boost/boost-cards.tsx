"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useLang, useT } from "@/lib/i18n/client";
import { cityLabel } from "@/lib/orders/cities";
import type { BuyerProfile } from "@/lib/orders/stats";
import { ADS_URL, AD_PLATFORMS, type AdPlatform, type PlatformTargeting } from "@/lib/orders/targeting";
import type { IgAudience } from "@/lib/publishers/instagram-audience";
import type { AiAudience } from "@/lib/orders/ai-audience";
import { formatMoney } from "@/lib/shop/money";
import { refreshAudienceAction } from "../orders/audience-action";

// The shop-wide audience cards (moved here from Orders on 2026-10-12): who buys, ready-to-paste
// boost settings per platform, and what the AI read in the buyers' messages.

/** Below this many orders the profile is too thin to trust for targeting. */
const MIN_AUDIENCE_ORDERS = 5;

/** The audience as labelled rows and as the text copied for Ads Manager. */
export function useAudienceText(a: BuyerProfile): { rows: [string, string][]; text: string } {
  const lang = useLang();
  const au = useT().orders.audience;
  const cities = a.cities.map((c) => cityLabel(c, lang)).join("، ");
  const hours = a.hours.map((h) => `${String(h).padStart(2, "0")}:00`).join("، ");
  const langs = a.languages.map((l) => au.lang[l as keyof typeof au.lang] ?? l).join("، ");
  const rows: [string, string][] = [
    [au.cities, cities],
    [au.hours, hours],
    [au.language, langs],
    [au.products, a.products.join("، ")],
  ].filter((r): r is [string, string] => !!r[1]);
  return { rows, text: rows.map(([k, v]) => `${k}: ${v}`).join("\n") };
}

export function AudienceCard({ a }: { a: BuyerProfile }) {
  const au = useT().orders.audience;
  const [copied, setCopied] = useState(false);
  const { rows, text } = useAudienceText(a);
  if (a.orders === 0 && a.messages === 0) return null;
  return (
    <div className="gm-card" style={{ marginBottom: 12 }}>
      <p className="gm-sec" style={{ margin: 0 }}>{au.title}</p>
      <p className="gm-hint">{au.sub(a.orders, a.messages)}</p>
      {rows.map(([k, v]) => (
        <div key={k} className="gm-target">
          <div><small>{k}</small><p>{v}</p></div>
        </div>
      ))}
      {a.orders < MIN_AUDIENCE_ORDERS && <p className="gm-note">{au.thin}</p>}
      <ul className="gm-hint" style={{ paddingInlineStart: 18 }}>
        {au.tips.map((t) => <li key={t}>{t}</li>)}
      </ul>
      <button type="button" className="gm-btn quiet small" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
        {copied ? au.copied : au.copy}
      </button>
    </div>
  );
}

export interface BoostView {
  targeting: Record<AdPlatform, PlatformTargeting>;
  ig: IgAudience | null;
  ai: (AiAudience & { basedOn: number; updatedAt: string }) | null;
  worked: string[];
  cityTags: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Boost settings for each platform, from the shop's buyers and Instagram followers, ready to paste. */
export function BoostCard({ b }: { b: BoostView }) {
  const t = useT();
  const bo = t.orders.boost;
  const lang = useLang();
  const [tab, setTab] = useState<AdPlatform>("FB");
  const [copied, setCopied] = useState<string | null>(null);
  const x = b.targeting[tab];
  const iqd = (n: number) => formatMoney(n, "IQD", lang);
  const langName = (l: string) => t.orders.audience.lang[l as keyof typeof t.orders.audience.lang] ?? l;
  const rows: [string, string][] = [
    [bo.objective, bo.objectives[x.objective]],
    [bo.locations, x.locations.map((c) => cityLabel(c, lang)).join("، ")],
    [bo.age, `${x.ageMin}–${x.ageMax}${x.fromFollowers ? ` (${bo.fromFollowers})` : ""}`],
    [bo.gender, `${bo.genders[x.gender]}${x.genderFromMessages ? ` (${bo.fromMessages})` : ""}`],
    [bo.language, x.languages.map(langName).join("، ")],
    ...(x.interests.length ? [[bo.interests, x.interests.join(", ")] as [string, string]] : []),
    [bo.placements, x.placements.map((p) => bo.placementNames[p]).join("، ")],
    [bo.format, bo.formats[x.format]],
    [bo.hours, x.hours.map((h) => `${String(h).padStart(2, "0")}:00`).join("، ")],
    [bo.budget, `${iqd(x.dailyIqd[0])} – ${iqd(x.dailyIqd[1])}`],
  ];
  const copy = (key: string, text: string) => navigator.clipboard.writeText(text).then(() => setCopied(key));
  const tags = [...b.worked, ...b.cityTags].join(" ");
  return (
    <div className="gm-card" style={{ marginBottom: 12 }}>
      <p className="gm-sec" style={{ margin: 0 }}>{bo.title}</p>
      <p className="gm-hint">{bo.sub}</p>
      <div className="gm-chips" role="tablist" aria-label={bo.title}>
        {AD_PLATFORMS.map((p) => (
          <button key={p} type="button" role="tab" className="gm-chip" aria-pressed={tab === p} aria-selected={tab === p} onClick={() => setTab(p)}>
            {t.platform[p]}
          </button>
        ))}
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="gm-target">
          <div><small>{k}</small><p>{v}</p></div>
        </div>
      ))}
      <p className="gm-hint">{bo.tips[tab]}</p>
      <div className="gm-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="gm-btn quiet small" onClick={() => copy(tab, rows.map(([k, v]) => `${k}: ${v}`).join("\n"))}>
          {copied === tab ? t.orders.audience.copied : bo.copy}
        </button>
        <a className="gm-btn quiet small" href={ADS_URL[tab]} target="_blank" rel="noreferrer">{bo.open[tab]}</a>
      </div>

      <AiAudienceSection ai={b.ai} />

      {b.ig && (
        <>
          <p className="gm-sub" style={{ margin: "14px 0 4px", fontWeight: 600 }}>{bo.igTitle}</p>
          {b.ig.ages.length > 0 && <p className="gm-hint" style={{ margin: 0 }}>{bo.igAges}: {b.ig.ages.map((a) => `${a.range} ${pct(a.share)}`).join(" · ")}</p>}
          {b.ig.women != null && <p className="gm-hint" style={{ margin: 0 }}>{bo.igGender(pct(b.ig.women), pct(b.ig.men ?? 0))}</p>}
          {b.ig.cities.length > 0 && <p className="gm-hint" style={{ margin: 0 }}>{bo.igCities}: {b.ig.cities.map((c) => `${c.name} ${pct(c.share)}`).join(" · ")}</p>}
        </>
      )}

      <p className="gm-sub" style={{ margin: "14px 0 4px", fontWeight: 600 }}>{bo.tagsTitle}</p>
      <p className="gm-hint" style={{ margin: 0 }} dir="auto">{tags}</p>
      {b.worked.length === 0 && <p className="gm-hint" style={{ margin: 0 }}>{bo.tagsNoHistory}</p>}
      <button type="button" className="gm-btn quiet small" style={{ marginTop: 6 }} onClick={() => copy("tags", tags)}>
        {copied === "tags" ? t.orders.audience.copied : bo.copyTags}
      </button>
    </div>
  );
}

/** What the AI read in the buyers' messages: who buys, ad angles, the questions an ad should answer. */
function AiAudienceSection({ ai }: { ai: BoostView["ai"] }) {
  const t = useT();
  const a = t.orders.boost.ai;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    start(async () => {
      setError(null);
      const r = await refreshAudienceAction();
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  return (
    <>
      <p className="gm-sub" style={{ margin: "14px 0 4px", fontWeight: 600 }}>{a.title}</p>
      {ai ? (
        <>
          <p className="gm-hint" style={{ margin: 0 }}>{a.sub(ai.basedOn)}</p>
          {ai.note && <p style={{ margin: "6px 0" }} dir="auto">{ai.note}</p>}
          {ai.angles.length > 0 && (
            <>
              <p className="gm-hint" style={{ margin: "6px 0 2px", fontWeight: 600 }}>{a.angles}</p>
              <ul className="gm-hint" style={{ margin: 0, paddingInlineStart: 18 }} dir="auto">{ai.angles.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
          {ai.questions.length > 0 && (
            <>
              <p className="gm-hint" style={{ margin: "6px 0 2px", fontWeight: 600 }}>{a.questions}</p>
              <ul className="gm-hint" style={{ margin: 0, paddingInlineStart: 18 }} dir="auto">{ai.questions.map((x) => <li key={x}>{x}</li>)}</ul>
            </>
          )}
        </>
      ) : (
        <p className="gm-hint" style={{ margin: 0 }}>{a.none}</p>
      )}
      <button type="button" className="gm-btn quiet small" style={{ marginTop: 6 }} disabled={pending} onClick={refresh}>
        {pending ? a.refreshing : a.refresh}
      </button>
      {error && <p className="gm-err" role="alert" style={{ marginTop: 4 }}>{error}</p>}
    </>
  );
}

