import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { mediaSrc } from "@/lib/cards/brand";
import { STUDIO_PACKS } from "@/lib/billing/prices";
import { imagePrice } from "@/lib/studio/pricing";
import { walletBalance } from "@/lib/studio/wallet";
import { settleReturn } from "../billing/load";
import { studioReadyFor } from "@/lib/studio/ready";
import { currentWorkspace } from "../data";
import { StudioClient, type StudioAssetView, type StudioProduct } from "./studio-client";

export const dynamic = "force-dynamic";

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ invoice?: string }> }) {
  const ws = (await currentWorkspace())!;
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT") return <p className="gm-note warn">{t.studio.shopOnly}</p>;
  if (!can(ws.role, "publish")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  // Back from Wayl: settle the top-up first, so the balance below already includes it.
  const paid = await settleReturn(ws.id, (await searchParams).invoice);
  const [products, kit, assets, balance] = await Promise.all([
    db.product.findMany({
      where: { active: true, store: { tenantId: ws.id }, NOT: { photos: { isEmpty: true } } },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, name: true, photos: true },
    }),
    db.brandKit.findUnique({ where: { tenantId: ws.id }, select: { logoPath: true, primary: true, accent: true, headingFont: true, tagline: true, deliveryNote: true } }),
    db.studioAsset.findMany({
      where: { tenantId: ws.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, status: true, aspect: true, sourceUrl: true, rawPath: true, finalUrl: true, headline: true, showPrice: true, error: true, createdAt: true },
    }),
    walletBalance(ws.id),
  ]);

  return (
    <StudioClient
      workspaceId={ws.id}
      ready={studioReadyFor(ws.id)}
      canConfigure={can(ws.role, "configure")}
      balance={balance}
      price={imagePrice().priceIqd}
      packs={Object.entries(STUDIO_PACKS).map(([id, amount]) => ({ id, amount }))}
      paid={paid}
      products={products satisfies StudioProduct[]}
      brand={{
        logoPath: kit?.logoPath ?? null,
        primary: kit?.primary ?? "#0B2545",
        accent: kit?.accent ?? "#E0A526",
        headingFont: kit?.headingFont === "sans" ? "sans" : "kufi",
        tagline: kit?.tagline ?? "",
        deliveryNote: kit?.deliveryNote ?? "",
      }}
      assets={assets.map(
        (a: (typeof assets)[number]): StudioAssetView => ({
          id: a.id,
          status: a.status as StudioAssetView["status"],
          aspect: a.aspect,
          // The finished ad, else the bare picture, else the shop's own photo while it is being made.
          image: a.finalUrl ?? mediaSrc(a.rawPath) ?? a.sourceUrl,
          finished: !!a.finalUrl,
          headline: a.headline,
          showPrice: a.showPrice,
          drawFailed: a.status === "DONE" && !a.finalUrl,
        }),
      )}
    />
  );
}
