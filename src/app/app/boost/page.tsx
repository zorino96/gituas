import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { withAccounts } from "@/lib/oauth/account-scope";
import { loadBuyerProfile, ordersByPost } from "@/lib/orders/audience";
import { cityHashtags, workedHashtags } from "@/lib/orders/hashtags";
import { targetingFor } from "@/lib/orders/targeting";
import { parseAiAudience } from "@/lib/orders/ai-audience";
import { cityFees } from "@/lib/shop/compose";
import { fetchIgAudience, fetchIgPosts } from "@/lib/publishers/instagram-audience";
import { loadBoostPosts } from "@/lib/boost/posts";
import { dailyAllowance, postKey, readBoostCache } from "@/lib/boost/cache";
import { AccountSwitcher } from "../account-switcher";
import { accountChoiceFrom, loadConnections, requireWorkspace } from "../data";
import { BoostClient } from "./boost-client";

export const dynamic = "force-dynamic";

/**
 * Boost & targeting: the shop-wide audience (who buys, settings per ad platform, what buyers write
 * about) and every recent post with what it already brought, each one analysable by the AI.
 */
export default async function BoostPage({ searchParams }: { searchParams: Promise<{ fb?: string; ig?: string }> }) {
  const ws = await requireWorkspace();
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT") return <p className="gm-note">{t.boost.shopOnly}</p>;
  if (!can(ws.role, "engage")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const { choice, lists } = await accountChoiceFrom(ws.id, await searchParams);
  const { conns, list, ig, igPosts } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    const [list, ig, igPosts] = await Promise.all([loadBoostPosts(ws.id, conns), fetchIgAudience(ws.id), fetchIgPosts(ws.id)]);
    return { conns, list, ig, igPosts };
  });
  const [audience, stores, insight, cache, allowance] = await Promise.all([
    loadBuyerProfile(ws.id),
    db.store.findMany({ where: { tenantId: ws.id }, select: { deliveryCityFees: true, deliveryFeeMinor: true, deliveryCurrency: true } }),
    db.audienceInsight.findUnique({ where: { tenantId: ws.id }, select: { data: true, basedOn: true, updatedAt: true } }),
    readBoostCache(ws.id),
    dailyAllowance(ws.id),
  ]);
  const ai = insight ? parseAiAudience(insight.data) : null;
  const deliverCities = [...new Set(stores.flatMap((s) => Object.keys(cityFees({ ...s, deliveryTime: null }))))];
  const perPost = await ordersByPost(ws.id, igPosts.map((p) => p.id));
  const boost = {
    targeting: targetingFor(audience, ig, deliverCities, ai),
    ig,
    ai: ai ? { ...ai, basedOn: insight!.basedOn, updatedAt: insight!.updatedAt.toISOString() } : null,
    worked: workedHashtags(igPosts, perPost),
    cityTags: cityHashtags(audience.cities),
  };
  const saved = Object.fromEntries(list.posts.map((p) => [postKey(p.platform, p.id), cache.posts[postKey(p.platform, p.id)] ?? null]).filter(([, v]) => v));

  return (
    <>
      <AccountSwitcher lists={{ FB: lists.META_FACEBOOK, IG: lists.META_INSTAGRAM }} selected={{ FB: conns.META_FACEBOOK.accountId, IG: conns.META_INSTAGRAM.accountId }} />
      <BoostClient
        audience={audience}
        boost={boost}
        posts={list.posts}
        errors={list.errors}
        saved={saved}
        left={Math.max(0, allowance - cache.used)}
        accounts={{ fb: conns.META_FACEBOOK.accountId ?? undefined, ig: conns.META_INSTAGRAM.accountId ?? undefined }}
      />
    </>
  );
}
