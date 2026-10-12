import Link from "next/link";

import { db } from "@/lib/db";
import { withAccounts } from "@/lib/oauth/account-scope";
import { adLibraryUrl, marketSignals } from "@/lib/orders/market";
import { AccountSwitcher } from "../account-switcher";
import { accountChoiceFrom, baseFor, currentWorkspace, loadConnections, loadInsights, loadPosts, loadYouTube } from "../data";
import { rankPosts } from "@/lib/merchant/state";
import { dict, getLang } from "@/lib/i18n";
import { ago } from "../format";

export const maxDuration = 60;

/** The shop's own numbers for the last 28 days, from what Gituas already receives: no Meta insights needed. */
async function loadOwnNumbers(tenantId: string) {
  const since = new Date(Date.now() - 28 * 86_400_000);
  const where = { store: { tenantId }, direction: "INBOUND" as const, createdAt: { gt: since } };
  const [dms, comments, orders] = await Promise.all([
    db.conversationMessage.count({ where: { ...where, channelType: "DM" } }),
    db.conversationMessage.count({ where: { ...where, channelType: "COMMENT" } }),
    db.order.count({ where: { tenantId, createdAt: { gt: since }, status: { notIn: ["CANCELLED", "RETURNED"] } } }),
  ]);
  return { dms, comments, orders };
}

/** The shop's own buyer signals for the market card, and its product names for the Ad Library links. */
async function loadMarket(tenantId: string) {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const [products, messages, orders] = await Promise.all([
    db.product.findMany({ where: { active: true, store: { tenantId } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 200 }),
    db.conversationMessage.findMany({
      where: { store: { tenantId }, direction: "INBOUND", createdAt: { gt: since }, commentType: { in: ["QUESTION", "ORDER", "NEGOTIATION"] } },
      select: { boundProductId: true, commentType: true, intent: true },
      take: 10000,
    }),
    db.order.findMany({ where: { tenantId, createdAt: { gt: since } }, select: { productId: true, status: true } }),
  ]);
  const names = Object.fromEntries(products.map((p) => [p.id, p.name]));
  const signals = marketSignals(messages, orders, names);
  // ponytail: Ad Library links use product names; a "category keywords" field would be sharper, add when merchants ask.
  return { ...signals, names: products.slice(0, 6).map((p) => p.name) };
}

// The metric names the engage clients return, in the order the tiles appear in.
// What a merchant calls them comes from the dictionary (t.insights.ig / t.insights.fb).
const IG_KEYS = ["followers", "reach_7d", "reach_28d", "posts"];
const FB_KEYS = ["page_post_engagements", "page_views_total", "page_total_actions"];

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ fb?: string; ig?: string; yt?: string }> }) {
  const t = dict(await getLang());
  const ws = (await currentWorkspace())!;
  const { choice, lists } = await accountChoiceFrom(ws.id, await searchParams);
  const { conns, insights, posts, youtube } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    const [insights, { posts }, youtube] = await Promise.all([loadInsights(ws.id, conns), loadPosts(ws.id, conns), loadYouTube(ws.id, conns)]);
    return { conns, insights, posts, youtube };
  });
  const top = rankPosts(posts, 5).filter((p) => p.commentCount > 0);
  const [market, own] = ws.kind === "MERCHANT" ? await Promise.all([loadMarket(ws.id), loadOwnNumbers(ws.id)]) : [null, null];
  const mk = t.insights.market;
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
    ...(own
      ? [
          { key: "own-dms", label: t.insights.own.dms, value: own.dms },
          { key: "own-comments", label: t.insights.own.comments, value: own.comments },
          { key: "own-orders", label: t.insights.own.orders, value: own.orders },
        ]
      : []),
  ];

  return (
    <div>
      <h2 className="gm-title kufi">{t.insights.title}</h2>
      <AccountSwitcher
        lists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM, YT: lists.YOUTUBE }}
        selected={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId, YT: conns.YOUTUBE.accountId }}
      />
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

      {market && (
        <>
          <p className="gm-sec">{mk.sec}</p>
          <div className="gm-card">
            {market.products.length === 0 ? (
              <p className="gm-sub" style={{ margin: 0 }}>{mk.empty}</p>
            ) : (
              market.products.map((p) => (
                <div key={p.productId} className="gm-target">
                  <div>
                    <p dir="auto">{p.name}</p>
                    <small>
                      {mk.asks} {t.fmt.num(p.asks)} · {mk.orders} {t.fmt.num(p.orders)} · {mk.haggles} {t.fmt.num(p.haggles)}
                    </small>
                  </div>
                </div>
              ))
            )}
            {market.advice.length > 0 && (
              <>
                <p className="gm-sec" style={{ marginTop: 12 }}>{mk.advice}</p>
                <ul className="gm-hint" style={{ paddingInlineStart: 18 }}>
                  {market.advice.map((a, i) => (
                    <li key={i}>
                      {a.kind === "lowConversion"
                        ? mk.lowConversion(a.name, a.asks, a.orders)
                        : a.kind === "priceHigh"
                          ? mk.priceHigh(a.name, a.pct)
                          : mk.topIntent(mk.intents[a.intent as keyof typeof mk.intents] ?? a.intent, a.pct)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {market.names.length > 0 && (
            <>
              <p className="gm-sec">{mk.rivalsSec}</p>
              <div className="gm-card">
                <p className="gm-hint" style={{ marginTop: 0 }}>{mk.rivalsHint}</p>
                <div className="gm-chips">
                  {market.names.map((n) => (
                    <a key={n} href={adLibraryUrl(n)} target="_blank" rel="noreferrer" className="gm-chip" dir="auto">
                      {mk.rivalsOpen}: {n}
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {insights.notes.length > 0 && (
        <p className="gm-note" style={{ marginTop: 14 }}>
          {t.insights.notes}
        </p>
      )}
    </div>
  );
}
