import Link from "next/link";
import { Hourglass, Lightbulb, ShoppingBag, Truck } from "lucide-react";

import { coachEnabled } from "@/lib/coach/enabled";
import { latestNote } from "@/lib/coach/read";
import { loadOrderTiles } from "@/lib/coach/tiles";
import { dict, type Lang } from "@/lib/i18n";
import { formatMoney } from "@/lib/shop/money";
import { loadLeaks } from "@/lib/shop/leaks";

/**
 * The growth coach's part of Today, for shop owners and admins while BUSINESS_PROFILE_ENABLED is on: the order tiles ("ordered, not
 * collected" is what buyers asked for, never "sales"), the "no order recorded" card (buyers who wrote and have no order in Gituas,
 * never "lost sales") and the latest weekly note with its label. Counts and the owner's own words only; every read has its own
 * fallback, so a failing one only hides its card.
 */
export async function TodayCoach({ tenantId, lang }: { tenantId: string; lang: Lang }) {
  if (!coachEnabled()) return null;
  const t = dict(lang);
  const [tiles, leaks, note] = await Promise.all([loadOrderTiles(tenantId), loadLeaks(tenantId), latestNote(tenantId, lang).catch(() => null)]);
  const showTiles = !!tiles && (tiles.week > 0 || tiles.open.count > 0 || tiles.delivered > 0);
  const showLeaks = !!leaks && leaks.hot + leaks.quiet > 0;
  if (!showTiles && !showLeaks && !note) return null;

  const more = leaks?.capped ? "+" : "";
  const openValue = tiles ? Object.entries(tiles.open.valueMinor).map(([cur, minor]) => formatMoney(minor, cur, lang)) : [];

  return (
    <div style={{ marginBottom: 14 }}>
      {showTiles && tiles && (
        <>
          <p className="gm-sec">{t.coach.ordersTitle}</p>
          <div className="gm-stats" style={{ marginBottom: 14 }}>
            <Link href="/app/orders" className="gm-stat">
              <span className="gm-stat-icon" aria-hidden="true"><ShoppingBag /></span>
              <b>{t.fmt.num(tiles.week)}</b>
              <span>
                {t.coach.ordersRecorded}
                <br />
                <small>
                  {t.coach.fromComments} {t.fmt.num(tiles.bySource.comments)} · {t.coach.fromMessages} {t.fmt.num(tiles.bySource.messages)} · {t.coach.byHand} {t.fmt.num(tiles.bySource.byHand)}
                </small>
              </span>
            </Link>
            <Link href="/app/orders" className="gm-stat" title={t.coach.orderedNotCollectedHint}>
              <span className="gm-stat-icon" aria-hidden="true"><Hourglass /></span>
              <b style={{ fontSize: openValue.length ? 22 : undefined, overflowWrap: "anywhere" }}>
                {openValue.length ? openValue.map((v, i) => <bdi key={i} style={{ display: "block" }}>{v}</bdi>) : t.fmt.num(0)}
              </b>
              <span>
                {t.coach.orderedNotCollected} · {t.fmt.num(tiles.open.count)}
                <br />
                <small>{t.coach.orderedNotCollectedHint}</small>
              </span>
            </Link>
            <Link href="/app/orders" className="gm-stat">
              <span className="gm-stat-icon" aria-hidden="true"><Truck /></span>
              <b>{t.fmt.num(tiles.delivered)}</b>
              <span>{t.coach.delivered}</span>
            </Link>
          </div>
        </>
      )}

      {showLeaks && leaks && (
        <div className="gm-card" style={{ marginBottom: 14 }}>
          <b className="kufi">{t.coach.leakTitle}</b>
          <div className="gm-stats" style={{ margin: "10px 0" }}>
            <Link href="/app/messages" className={`gm-stat ${leaks.hot ? "hot" : ""}`}>
              <b>{t.fmt.num(leaks.hot)}{more}</b>
              <span>{t.coach.leakHot}</span>
            </Link>
            <Link href="/app/messages" className="gm-stat">
              <b>{t.fmt.num(leaks.quiet)}{more}</b>
              <span>{t.coach.leakQuiet}</span>
            </Link>
          </div>
          <p className="gm-sub" style={{ margin: "0 0 10px" }}>{t.coach.leakNote}</p>
          <Link href="/app/messages" className="gm-btn">{t.coach.leakCta}</Link>
        </div>
      )}

      {note && (
        <div className="gm-card">
          <div className="gm-between">
            <b className="kufi">{t.coach.noteTitle}</b>
            <span className="gm-badge" dir="ltr">{note.week}</span>
          </div>
          <p style={{ margin: "8px 0 4px", fontWeight: 600 }}>{note.body.headline}</p>
          <ul style={{ margin: "0 0 10px", paddingInlineStart: 20 }}>
            {note.body.points.slice(0, 4).map((p) => (
              <li key={p.key} style={{ marginBottom: 4 }}>{p.text}</li>
            ))}
          </ul>
          {note.body.tryThis.length > 0 && (
            <>
              <p className="gm-sec" style={{ display: "flex", alignItems: "center", gap: 6 }}><Lightbulb size={14} aria-hidden="true" />{t.coach.tryTitle}</p>
              <ul style={{ margin: "0 0 10px", paddingInlineStart: 20 }}>
                {note.body.tryThis.map((x, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{x}</li>
                ))}
              </ul>
            </>
          )}
          <p className="gm-sub" style={{ margin: "0 0 10px" }}>
            {note.label} · {note.source === "ai" ? t.coach.aiBadge : t.coach.rulesBadge}
          </p>
          <Link href="/app/assistant" className="gm-btn">{t.coach.askChat}</Link>
        </div>
      )}
    </div>
  );
}
