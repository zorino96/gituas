import Link from "next/link";

import { currentWorkspace, loadConnections, loadInsights, loadPosts } from "../data";
import { rankPosts } from "@/lib/merchant/state";
import { PLATFORM_NAME, ago, num } from "../format";

export const maxDuration = 60;

// Graph metric names → what a merchant calls them.
const METRIC_LABEL: Record<string, string> = {
  reach: "گەیشتن",
  impressions: "بینین",
  views: "بینین",
  profile_views: "سەردانی پرۆفایل",
  website_clicks: "کلیکی ماڵپەڕ",
  accounts_engaged: "ئەکاونتی بەشداربوو",
  total_interactions: "کارلێک",
  follower_count: "شوێنکەوتووی نوێ",
  page_post_engagements: "کارلێک لەگەڵ پۆستەکان",
  page_views_total: "سەردانی پەیج",
  page_total_actions: "کلیک لەسەر پەیج",
  page_daily_follows_unique: "شوێنکەوتووی نوێ",
};

export default async function InsightsPage() {
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const [insights, { posts }] = await Promise.all([loadInsights(ws.id, conns), loadPosts(ws.id, conns)]);
  const top = rankPosts(posts, 5).filter((p) => p.commentCount > 0);
  const metrics = [
    ...insights.igMetrics.map((m) => ({ ...m, platform: "IG" as const })),
    ...insights.fbMetrics.map((m) => ({ ...m, platform: "FB" as const })),
  ].filter((m) => METRIC_LABEL[m.name]);

  return (
    <div>
      <h2 className="gm-title kufi">ئامار</h2>
      <p className="gm-sub">کام پۆست کڕیاری بۆ هێنایت، و چەند کەس چوونە وەتسئەپ.</p>

      <div className="gm-kpis">
        <div className="gm-kpi">
          <b>{num(insights.fbFollowers)}</b>
          <span>شوێنکەوتووی فەیسبووک</span>
        </div>
        <div className="gm-kpi">
          <b>{num(insights.waTaps7d)}</b>
          <span>چوونە وەتسئەپ · ٧ ڕۆژ</span>
        </div>
        {metrics.slice(0, 4).map((m) => (
          <div key={`${m.platform}-${m.name}`} className="gm-kpi">
            <b>{num(m.value)}</b>
            <span>
              {METRIC_LABEL[m.name]} · {PLATFORM_NAME[m.platform]}
            </span>
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
