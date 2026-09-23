import Link from "next/link";

import { currentWorkspace, loadConnections, loadInsights, loadPosts } from "../data";
import { rankPosts } from "@/lib/merchant/state";
import { PLATFORM_NAME, ago, num } from "../format";

export const maxDuration = 60;

// The metric names the engage clients return → what a merchant calls them.
// Order here is the order the tiles appear in.
const IG_LABEL: Record<string, string> = {
  followers: "شوێنکەوتووی ئینستاگرام",
  reach_7d: "گەیشتنی ئینستاگرام · ٧ ڕۆژ",
  reach_28d: "گەیشتنی ئینستاگرام · ٢٨ ڕۆژ",
  posts: "پۆستی ئینستاگرام",
};
const FB_LABEL: Record<string, string> = {
  page_post_engagements: "کارلێک لەگەڵ پۆستەکانی فەیسبووک",
  page_views_total: "سەردانی پەیجی فەیسبووک",
  page_total_actions: "کلیک لەسەر پەیجی فەیسبووک",
};

export default async function InsightsPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const [insights, { posts }] = await Promise.all([loadInsights(ws.id, conns), loadPosts(ws.id, conns)]);
  const top = rankPosts(posts, 5).filter((p) => p.commentCount > 0);
  const pick = (list: { name: string; value: number }[], labels: Record<string, string>) =>
    Object.keys(labels).flatMap((k) => {
      const m = list.find((x) => x.name === k);
      return m ? [{ key: k, label: labels[k], value: m.value }] : [];
    });
  const tiles = [
    ...(conns.META_FACEBOOK.connected ? [{ key: "fb-followers", label: "شوێنکەوتووی فەیسبووک", value: insights.fbFollowers }] : []),
    ...pick(insights.igMetrics, IG_LABEL),
    ...pick(insights.fbMetrics, FB_LABEL),
    { key: "wa", label: "چوونە وەتسئەپ · ٧ ڕۆژ", value: insights.waTaps7d },
  ];

  return (
    <div>
      <h2 className="gm-title kufi">ئامار</h2>
      <p className="gm-sub">کام پۆست کڕیاری بۆ هێنایت، و چەند کەس چوونە وەتسئەپ.</p>

      <div className="gm-kpis">
        {tiles.map((t) => (
          <div key={t.key} className="gm-kpi">
            <b>{num(t.value)}</b>
            <span>{t.label}</span>
          </div>
        ))}
      </div>

      <p className="gm-sec">پۆستەکانی زۆرترین کۆمێنت</p>
      <div className="gm-card">
        {top.length === 0 ? (
          <p className="gm-sub" style={{ margin: 0 }}>
            هێشتا هیچ پۆستێک کۆمێنتی نییە. <Link href="/app/publish" className="gm-link">پۆستێک بڵاو بکەرەوە</Link>
          </p>
        ) : (
          top.map((p) => (
            <div key={`${p.platform}-${p.id}`} className="gm-rank">
              {p.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbUrl} alt="" className="gm-thumb" style={{ width: 38, height: 38, flexBasis: 38 }} />
              ) : (
                <div className="gm-thumb" style={{ width: 38, height: 38, flexBasis: 38 }} aria-hidden="true" />
              )}
              <div style={{ minWidth: 0 }}>
                <div className="gm-row" style={{ gap: 6 }}>
                  <span className={`gm-plat ${p.platform}`}>{PLATFORM_NAME[p.platform]}</span>
                  <span className="gm-time">{ago(p.createdAt)}</span>
                </div>
                <div className="gm-time" dir="auto" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "52vw" }}>
                  {p.caption || "(بێ دەق)"}
                </div>
              </div>
              <b>{num(p.commentCount)}</b>
            </div>
          ))
        )}
      </div>

      {insights.notes.length > 0 && (
        <p className="gm-note" style={{ marginTop: 14 }}>
          هەندێک ئامار نەهات: مێتا ئامار بۆ پەیجی نوێ یان بچووک هەمیشە نادات. ئەوانەی سەرەوە ئەوەن کە هاتن.
        </p>
      )}
    </div>
  );
}
