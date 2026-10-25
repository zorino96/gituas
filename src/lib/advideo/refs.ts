// The owner's reference material for video ads: pictures of the product and the brand as they really
// are, and short clips of the shop. Uploaded from the Video page straight to Blob under the store's
// own folder; there is no table: the folder listing is the list. The director looks at the pictures
// (as small JPEGs), the renderer shows both pictures and clips inside the ad.

import { del, list } from "@/lib/storage";
import sharp from "sharp";

import { isRefPath, REF_LIMITS, refKind, refPrefix, type RefKind } from "./ref-paths";

export { isRefPath, REF_LIMITS, refKind, refPrefix, type RefKind } from "./ref-paths";

export interface RefItem {
  url: string;
  pathname: string;
  kind: RefKind;
  name: string;
  size: number;
  uploadedAt: string;
}

/** The store's reference files, newest first, within the limits (the extra ones are left out, not deleted). */
export async function listRefs(tenantId: string, storeId: string): Promise<RefItem[]> {
  const prefix = refPrefix(tenantId, storeId);
  let blobs: { url: string; pathname: string; size: number; uploadedAt: Date }[] = [];
  try {
    blobs = (await list({ prefix, limit: 100 })).blobs;
  } catch {
    return [];
  }
  const items: RefItem[] = [];
  for (const b of blobs) {
    const kind = refKind(b.pathname);
    if (!kind) continue;
    if (kind === "image" && b.size > REF_LIMITS.imageBytes) continue;
    if (kind === "video" && b.size > REF_LIMITS.videoBytes) continue;
    items.push({ url: b.url, pathname: b.pathname, kind, name: b.pathname.slice(prefix.length).replace(/-[A-Za-z0-9]{20,}(?=\.)/, ""), size: b.size, uploadedAt: new Date(b.uploadedAt).toISOString() });
  }
  items.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const images = items.filter((i) => i.kind === "image").slice(0, REF_LIMITS.images);
  const videos = items.filter((i) => i.kind === "video").slice(0, REF_LIMITS.videos);
  return [...images, ...videos];
}

/** Removes one reference file the owner chose to remove (their own upload, checked by path). */
export async function removeRef(tenantId: string, storeId: string, pathname: string): Promise<boolean> {
  if (!isRefPath(pathname, tenantId, storeId)) return false;
  try {
    await del(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * The pictures as small JPEG data URLs, for the director to look at. Only files this store listed
 * are fetched; each is cut to 768 px on its long side, so a few hundred kilobytes in all.
 */
export async function refImagesForModel(images: RefItem[], max: number = REF_LIMITS.seen): Promise<string[]> {
  // Fetched side by side, each with its own short limit: a slow file must not eat the time a video has to be made in.
  const picks = images.filter((i) => i.kind === "image").slice(0, max);
  const done = await Promise.all(
    picks.map(async (it) => {
      try {
        const res = await fetch(it.url, { signal: AbortSignal.timeout(8_000) });
        if (!res.ok) return null;
        const jpeg = await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 72 })
          .toBuffer();
        return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      } catch {
        return null; // a picture that cannot be read is skipped
      }
    }),
  );
  return done.filter((x): x is string => !!x);
}
