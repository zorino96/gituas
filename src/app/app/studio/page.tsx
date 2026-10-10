import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { mediaSrc } from "@/lib/cards/brand";
import { creditsLeft } from "@/lib/studio/credits";
import { studioReady } from "@/lib/studio/ready";
import { currentWorkspace } from "../data";
import { StudioClient, type StudioAssetView, type StudioProduct } from "./studio-client";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const ws = (await currentWorkspace())!;
  const t = dict(await getLang());
  if (ws.kind !== "MERCHANT") return <p className="gm-note warn">{t.studio.shopOnly}</p>;
  if (!can(ws.role, "publish")) return <p className="gm-note warn">{t.nr.team.roles.notAllowed}</p>;

  const [products, kit, assets, credits] = await Promise.all([
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
    creditsLeft(ws.id),
  ]);

  return (
    <StudioClient
      workspaceId={ws.id}
      ready={studioReady()}
      canConfigure={can(ws.role, "configure")}
      credits={credits}
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
        (a): StudioAssetView => ({
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
