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
  const stores = await db.store.findMany({
    where: { tenantId: ws.id },
    select: { id: true, name: true, fbPageId: true, igUserId: true, deliveryCityFees: true, deliveryFeeMinor: true, deliveryCurrency: true },
  });
  const { conns, list, ig, igPosts, store, igElsewhere } = await withAccounts(choice, async () => {
    const conns = await loadConnections(ws.id);
    // One business at a time: the chosen Page decides it (or the Instagram account, with no Page).
    // A Page and an Instagram account of two different businesses are never mixed in one list.
    const fbId = conns.META_FACEBOOK.connected ? conns.META_FACEBOOK.accountId : undefined;
    const igId = conns.META_INSTAGRAM.connected ? conns.META_INSTAGRAM.accountId : undefined;
    const store = stores.find((s) => fbId && s.fbPageId === fbId) ?? stores.find((s) => igId && s.igUserId === igId) ?? (stores.length === 1 ? stores[0] : null);
    const include = {
      fb: !!fbId && (!store || !store.fbPageId || store.fbPageId === fbId),
      ig: !!igId && (!store || store.igUserId === igId || (!store.igUserId && !stores.some((s) => s.igUserId === igId))),
    };
    const owner = igId && !include.ig ? stores.find((s) => s.igUserId === igId) : undefined;
    const [list, ig, igPosts] = await Promise.all([
      loadBoostPosts(ws.id, conns, include),
      include.ig ? fetchIgAudience(ws.id) : Promise.resolve(null),
      include.ig ? fetchIgPosts(ws.id) : Promise.resolve([]),
    ]);
    const igElsewhere = owner
      ? {
          account: conns.META_INSTAGRAM.name ?? "Instagram",
          business: owner.name,
          // It can join the business being shown when that one has no Instagram account yet.
          moveTo: store && !store.igUserId && igId ? { storeId: store.id, igUserId: igId, business: store.name } : null,
        }
      : null;
    return { conns, list, ig, igPosts, store, igElsewhere };
  });
  const [audience, insight, cache, allowance] = await Promise.all([
    loadBuyerProfile(ws.id, store?.id),
    db.audienceInsight.findUnique({ where: { tenantId: ws.id }, select: { data: true, basedOn: true, updatedAt: true } }),
    readBoostCache(ws.id),
    dailyAllowance(ws.id),
  ]);
  const ai = insight ? parseAiAudience(insight.data) : null;
  const deliverCities = [...new Set((store ? [store] : stores).flatMap((s) => Object.keys(cityFees({ ...s, deliveryTime: null }))))];
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
        business={store?.name ?? null}
        igElsewhere={igElsewhere}
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
