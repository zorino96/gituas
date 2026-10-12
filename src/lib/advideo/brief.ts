// What the director model and the renderer are told about a brand: its name, colours, logo,
// contact lines and one product (or the whole shop). All of it comes from the shop's own rows.

import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { isJpegPath, isOwnBlobUrl, isOwnPathname } from "@/lib/merchant/caption";
import { formatMoney } from "@/lib/shop/money";
import { deliveryLine } from "@/lib/shop/compose";

export interface AdProduct {
  id: string;
  name: string;
  description: string | null;
  /** The price as the shop shows it ("لە ٢٥٬٠٠٠ دینار"), or null for no price. */
  priceLine: string | null;
  photos: string[];
}

export interface AdBrief {
  name: string;
  tagline: string | null;
  deliveryNote: string | null;
  deliveryLine: string | null;
  primary: string;
  accent: string;
  logoUrl: string | null;
  /** "@handle" of the Instagram account, when connected. */
  handle: string | null;
  /** The number buyers can reach, as it is written on the screen. */
  phone: string | null;
  product: AdProduct | null;
  /** Other products on sale, to talk about the shop in general. */
  catalog: { name: string; priceLine: string | null }[];
  /** Photos a product scene may show: the product's, else the newest products'. */
  photos: string[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_PHOTOS = 6;

/** "9647501234567" → "0750 123 4567"; a number that is not an Iraqi mobile is shown as it was given. */
export function displayPhone(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const local = digits.startsWith("964") ? `0${digits.slice(3)}` : digits;
  return /^07\d{9}$/.test(local) ? `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}` : local;
}

/** The lowest price among the variants in stock, "from" when they differ; null when nothing is priced. */
export function priceLineOf(variants: { amountMinor: number; currency: string; inStock: boolean }[]): string | null {
  const priced = variants.filter((v) => v.inStock && v.amountMinor > 0);
  if (!priced.length) return null;
  const low = priced.reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a));
  const differ = priced.some((v) => v.amountMinor !== low.amountMinor);
  return `${differ ? "لە " : ""}${formatMoney(low.amountMinor, low.currency, "ckb")}`;
}

/** Only photos this workspace uploaded and a renderer can read (JPEG). */
export function usablePhotos(urls: string[], tenantId: string): string[] {
  return urls.filter((u) => isOwnBlobUrl(u, tenantId) && isJpegPath(new URL(u).pathname));
}

export async function loadAdBrief(storeId: string, productId: string | null): Promise<AdBrief | null> {
  const store = await db.store.findUnique({
    where: { id: storeId },
    include: { tenant: { select: { id: true, name: true, whatsappNumber: true } } },
  });
  if (!store) return null;
  const tenantId = store.tenantId;
  const [kit, products] = await Promise.all([
    db.brandKit.findUnique({ where: { tenantId }, select: { logoPath: true, primary: true, accent: true, tagline: true, deliveryNote: true } }),
    db.product.findMany({
      where: { storeId, active: true },
      orderBy: { updatedAt: "desc" },
      take: 24,
      select: { id: true, name: true, description: true, photos: true, variants: { select: { amountMinor: true, currency: true, inStock: true } } },
    }),
  ]);
  const chosen = productId ? products.find((p) => p.id === productId) ?? null : null;
  const asProduct = (p: (typeof products)[number]): AdProduct => ({
    id: p.id,
    name: p.name,
    description: p.description?.trim() || null,
    priceLine: priceLineOf(p.variants),
    photos: usablePhotos(p.photos, tenantId),
  });
  const product = chosen ? asProduct(chosen) : null;
  const others = products.filter((p) => p.id !== chosen?.id);
  const photos = product?.photos.length
    ? product.photos.slice(0, MAX_PHOTOS)
    : others.flatMap((p) => usablePhotos(p.photos, tenantId).slice(0, 1)).slice(0, MAX_PHOTOS);
  return {
    name: store.name.trim() || store.tenant.name || (store.igUsername ? `@${store.igUsername}` : "Shop"),
    tagline: kit?.tagline?.trim() || null,
    deliveryNote: kit?.deliveryNote?.trim() || null,
    deliveryLine: deliveryLine(store, "ckb"),
    primary: kit?.primary && HEX.test(kit.primary) ? kit.primary : "#0B2545",
    accent: kit?.accent && HEX.test(kit.accent) ? kit.accent : "#E0A526",
    // Served through our own /m route, as the reels do, so the renderer fetches it from our domain.
    logoUrl: isOwnPathname(kit?.logoPath, tenantId) ? `${SHOP_ORIGIN}/m/${kit!.logoPath}` : null,
    handle: store.igUsername ? `@${store.igUsername}` : null,
    phone: displayPhone(store.tenant.whatsappNumber),
    product,
    catalog: others.slice(0, 8).map((p) => ({ name: p.name, priceLine: priceLineOf(p.variants) })),
    photos,
  };
}
