// One Studio ad, alone on the page at its own size, for the headless browser in
// src/lib/cards/server-render.ts to screenshot (src/lib/studio/jobs.ts). No shell and no
// session: the signed, five-minute token in ?t= is what lets a request in.
import "@/app/app/app.css";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { gmFontVars } from "@/app/app/fonts";
import { brandFrom, mediaSrc } from "@/lib/cards/brand";
import { verifyRenderToken } from "@/lib/cards/render-token";
import { db } from "@/lib/db";
import { StudioAd } from "@/lib/studio/ad-template";
import { ASPECT_PX, isStudioAspect } from "@/lib/studio/presets";
import { priceLine } from "@/lib/studio/price";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ad", robots: { index: false, follow: false } };

const PAGE_CSS = "html, body { margin: 0; padding: 0; background: #fff; } nextjs-portal { display: none !important; }";

export default async function StudioRenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const [{ id }, { t }] = await Promise.all([params, searchParams]);
  if (!verifyRenderToken(`studio:${id}`, t)) notFound();

  const asset = await db.studioAsset.findUnique({
    where: { id },
    select: { tenantId: true, productId: true, aspect: true, rawPath: true, headline: true, showPrice: true },
  });
  if (!asset?.rawPath || !isStudioAspect(asset.aspect)) notFound();
  const [kit, tenant, product] = await Promise.all([
    db.brandKit.findUnique({
      where: { tenantId: asset.tenantId },
      select: { logoPath: true, primary: true, accent: true, text: true, headingFont: true, tagline: true, deliveryNote: true },
    }),
    db.tenant.findUnique({ where: { id: asset.tenantId }, select: { name: true, whatsappNumber: true } }),
    asset.productId && asset.showPrice
      ? db.product.findFirst({ where: { id: asset.productId, store: { tenantId: asset.tenantId } }, select: { variants: { select: { amountMinor: true, currency: true, inStock: true } } } })
      : null,
  ]);
  if (!tenant) notFound();
  const { width, height } = ASPECT_PX[asset.aspect];

  return (
    <div className={`gm ${gmFontVars}`} dir="rtl" lang="ckb">
      <style>{PAGE_CSS}</style>
      <div id="card" dir="ltr" style={{ position: "fixed", top: 0, left: 0, width, height, margin: 0, overflow: "hidden" }}>
        <StudioAd
          width={width}
          height={height}
          brand={{
            ...brandFrom(kit, tenant.name),
            tagline: kit?.tagline ?? null,
            deliveryNote: kit?.deliveryNote ?? null,
            whatsapp: tenant.whatsappNumber,
          }}
          content={{ photoSrc: mediaSrc(asset.rawPath)!, headline: asset.headline, price: product ? priceLine(product.variants) : null }}
        />
      </div>
    </div>
  );
}
