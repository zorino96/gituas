// What the director model and the renderer are told about a brand: its name, colours, logo,
// contact lines and one product (or the whole shop). All of it comes from the shop's own rows.

import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { isJpegPath, isOwnBlobUrl, isOwnPathname } from "@/lib/merchant/caption";
import { formatMoney } from "@/lib/shop/money";
import { deliveryLine } from "@/lib/shop/compose";
import type { RefItem } from "./refs";

export interface AdProduct {
  id: string;
  name: string;
  description: string | null;
  /** The price as the shop shows it ("لە ٢٥٬٠٠٠ دینار"), or null for no price. */
  priceLine: string | null;
  photos: string[];
  /** Whether any variant can be bought (a product with no variants counts as in stock). */
  inStock: boolean;
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
  /** Photos a product scene may show: the product's own, then the owner's reference pictures, else the newest products'. */
  photos: string[];
  /** How many of the photos are the owner's reference pictures. */
  refPhotos: number;
  /** The positions, in `photos`, of the owner's reference pictures. */
  refIndices: number[];
  /** The owner's own short clips (reference videos), shown inside the ad. */
  clips: string[];
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

export async function loadAdBrief(storeId: string, productId: string | null, refs: RefItem[] = []): Promise<AdBrief | null> {
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
  let chosen = productId ? products.find((p) => p.id === productId) ?? null : null;
  // The chosen product may be older than the 24 most recently edited: it is still the one to show.
  if (productId && !chosen) {
    chosen = await db.product.findFirst({
      where: { id: productId, storeId, active: true },
      select: { id: true, name: true, description: true, photos: true, variants: { select: { amountMinor: true, currency: true, inStock: true } } },
    });
  }
  const asProduct = (p: (typeof products)[number]): AdProduct => ({
    id: p.id,
    name: p.name,
    description: p.description?.trim() || null,
    priceLine: priceLineOf(p.variants),
    photos: usablePhotos(p.photos, tenantId),
    inStock: p.variants.length === 0 || p.variants.some((v) => v.inStock),
  });
  const product = chosen ? asProduct(chosen) : null;
  const others = products.filter((p) => p.id !== chosen?.id);
  // A chosen product shows only its own photos (none: the ad has no product scene); a shop-wide ad uses the newest products' photos.
  const own = product ? product.photos : others.flatMap((p) => usablePhotos(p.photos, tenantId).slice(0, 1));
  // The owner's reference pictures are their own choice of how the brand looks: they come after the product's photos, before the filler.
  const refImages = refs.filter((r) => r.kind === "image" && isOwnBlobUrl(r.url, tenantId)).map((r) => r.url);
  const photos = [...(product ? own : [...refImages, ...own]), ...(product ? refImages : [])].slice(0, MAX_PHOTOS);
  const clips = refs.filter((r) => r.kind === "video" && isOwnBlobUrl(r.url, tenantId)).map((r) => r.url).slice(0, 3);
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
    refPhotos: photos.filter((u) => refImages.includes(u)).length,
    refIndices: photos.flatMap((u, i) => (refImages.includes(u) ? [i] : [])),
    clips,
  };
}
