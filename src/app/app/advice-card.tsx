"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { useLang, useT } from "@/lib/i18n/client";
import { cityLabel } from "@/lib/orders/cities";
import type { PostAdvice } from "@/lib/orders/post-advice";
import { formatMoney } from "@/lib/shop/money";

/**
 * The AI's boost advice for one post: worth it or not, where, for whom, what to fix first and, for a
 * published post, what its reaction shows. Used in Publish (a post being written) and Boost (posts
 * already out).
 */
export function AdviceCard({ a, onClose, title }: { a: PostAdvice; onClose?: () => void; title?: string }) {
  const t = useT();
  const lang = useLang();
  const ad = t.publish.advice;
  const bo = t.orders.boost;
  const [copied, setCopied] = useState(false);
  const rows: [string, string][] = [
    [ad.platform, `${t.platform[a.bestPlatform]} — ${a.platformWhy}`],
    [bo.objective, bo.objectives[a.objective]],
    [bo.age, `${a.ageMin}–${a.ageMax}`],
    [bo.gender, bo.genders[a.gender]],
    ...(a.interests.length ? [[bo.interests, a.interests.join(", ")] as [string, string]] : []),
    [bo.locations, a.locations.map((c) => cityLabel(c, lang)).join("، ")],
    [bo.budget, `${formatMoney(a.dailyIqd[0], "IQD", lang)} – ${formatMoney(a.dailyIqd[1], "IQD", lang)}`],
  ];
  return (
    <div className="gm-card" style={{ marginTop: 10 }}>
      <div className="gm-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="gm-sec" style={{ margin: 0 }}>{title ?? ad.title}</p>
        {onClose && (
          <button type="button" className="gm-btn quiet small" onClick={onClose} aria-label={ad.title}>
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className={a.worthBoosting ? "gm-ok" : "gm-note warn"} style={{ margin: "6px 0" }} dir="auto">
        {a.worthBoosting ? ad.worth : ad.notWorth} {a.reason}
      </p>
      {a.observations.length > 0 && (
        <>
          <p className="gm-hint" style={{ margin: "6px 0 2px", fontWeight: 600 }}>{ad.observations}</p>
          <ul className="gm-hint" style={{ margin: "0 0 6px", paddingInlineStart: 18 }} dir="auto">{a.observations.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {a.creativeScore != null && <p style={{ margin: "4px 0", fontWeight: 600 }}>{ad.score(a.creativeScore)}</p>}
      {a.creativeNotes.length > 0 && (
        <ul className="gm-hint" style={{ margin: "0 0 6px", paddingInlineStart: 18 }} dir="auto">{a.creativeNotes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      {rows.map(([k, v]) => (
        <div key={k} className="gm-target">
          <div><small>{k}</small><p dir="auto">{v}</p></div>
        </div>
      ))}
      <button type="button" className="gm-btn quiet small" onClick={() => navigator.clipboard.writeText(rows.map(([k, v]) => `${k}: ${v}`).join("\n")).then(() => setCopied(true))}>
        {copied ? t.orders.audience.copied : bo.copy}
      </button>
    </div>
  );
}
