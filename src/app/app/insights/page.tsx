import Link from "next/link";

import { baseFor, currentWorkspace, loadConnections, loadInsights, loadPosts, loadYouTube } from "../data";
import { rankPosts } from "@/lib/merchant/state";
import { dict, getLang } from "@/lib/i18n";
import { ago } from "../format";

export const maxDuration = 60;

// The metric names the engage clients return, in the order the tiles appear in.
// What a merchant calls them comes from the dictionary (t.insights.ig / t.insights.fb).
const IG_KEYS = ["followers", "reach_7d", "reach_28d", "posts"];
const FB_KEYS = ["page_post_engagements", "page_views_total", "page_total_actions"];

export default async function InsightsPage() {
  const t = dict(await getLang());
  const ws = (await currentWorkspace())!;
  const conns = await loadConnections(ws.id);
  const [insights, { posts }, youtube] = await Promise.all([loadInsights(ws.id, conns), loadPosts(ws.id, conns), loadYouTube(ws.id, conns)]);
  const top = rankPosts(posts, 5).filter((p) => p.commentCount > 0);
  const pick = (list: { name: string; value: number }[], keys: string[], labels: Record<string, string>) =>
    keys.flatMap((k) => {
      const m = list.find((x) => x.name === k);
      return m ? [{ key: k, label: labels[k], value: m.value }] : [];
    });
  const tiles = [
    ...(conns.META_FACEBOOK.connected ? [{ key: "fb-followers", label: t.insights.fbFollowers, value: insights.fbFollowers }] : []),
    ...pick(insights.igMetrics, IG_KEYS, t.insights.ig),
    ...pick(insights.fbMetrics, FB_KEYS, t.insights.fb),
    ...(ws.kind === "MERCHANT" ? [{ key: "wa", label: t.insights.whatsapp7d, value: insights.waTaps7d }] : []),
  ];

  return (
    <div>
      <h2 className="gm-title kufi">{t.insights.title}</h2>
      <p className="gm-sub">
        {ws.kind === "NEWS" ? t.insights.subNews : t.insights.subShop}
      </p>

      <div className="gm-kpis">
        {tiles.map((tile) => (
          <div key={tile.key} className="gm-kpi">
            <b>{t.fmt.num(tile.value)}</b>
            <span>{tile.label}</span>
          </div>
        ))}
      </div>

      {youtube && (
        <>
          <p className="gm-sec">{t.platform.YT}</p>
          {youtube.error ? (
            <p className="gm-note">
              {t.insights.ytFailed} <Link href={`${baseFor(ws.kind)}/settings`} className="gm-link">{t.insights.ytReconnect}</Link>
            </p>
          ) : (
            <>
              <div className="gm-kpis">
                {youtube.tiles.map((tile) => (
                  <div key={tile.key} className="gm-kpi">
                    <b>{t.fmt.num(tile.value)}</b>
                    <span>{(t.insights.yt as Record<string, string>)[tile.key] ?? tile.label}</span>
                  </div>
                ))}
              </div>
              {youtube.top.length > 0 && (
                <div className="gm-card" style={{ marginTop: 8 }}>
                  {youtube.top.map((v) => (
                    <div key={v.id} className="gm-rank">
                      {v.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={v.thumbnailUrl} alt="" className="gm-thumb" style={{ width: 38, height: 38, flexBasis: 38 }} />
                      ) : (
                        <div className="gm-thumb" style={{ width: 38, height: 38, flexBasis: 38 }} aria-hidden="true" />
                      )}
                      <a
                        href={v.permalinkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="gm-time"
                        dir="auto"
                        style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "52vw" }}
                      >
                        {v.title || t.insights.noTitle}
                      </a>
                      <b>
                        {t.fmt.num(v.views)} <span className="gm-time">{t.common.views}</span>
                      </b>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <p className="gm-sec">{t.insights.topSec}</p>
      <div className="gm-card">
        {top.length === 0 ? (
          <p className="gm-sub" style={{ margin: 0 }}>
            {t.insights.topEmpty} <Link href={`${baseFor(ws.kind)}/publish`} className="gm-link">{t.insights.topPublish}</Link>
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
                  <span className={`gm-plat ${p.platform}`}>{t.platform[p.platform]}</span>
                  <span className="gm-time">{ago(p.createdAt, t)}</span>
                </div>
                <div className="gm-time" dir="auto" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "52vw" }}>
                  {p.caption || t.common.noText}
                </div>
              </div>
              <b>{t.fmt.num(p.commentCount)}</b>
            </div>
          ))
        )}
      </div>

      {insights.notes.length > 0 && (
        <p className="gm-note" style={{ marginTop: 14 }}>
          {t.insights.notes}
        </p>
      )}
    </div>
  );
}
