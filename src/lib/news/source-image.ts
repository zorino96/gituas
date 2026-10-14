// The picture a source's feed gave with a story, kept in the desk's own folder so the card can be drawn from it.
// Only for desks that turned "source pictures" on; the card then credits the source. Never throws.

import { put } from "@vercel/blob";
import sharp from "sharp";

import { assertPublicHost } from "./sources/rss";

const MAX_BYTES = 6 * 1024 * 1024;
const MAX_HOPS = 3;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** The marker in a stored pathname that tells the card to credit the source. */
export const SOURCE_IMAGE_MARK = "/source-img-";

export const isSourceImage = (pathname: string | null | undefined): boolean => !!pathname && pathname.includes(SOURCE_IMAGE_MARK);

export async function storeSourceImage(tenantId: string, imageUrl: string, timeoutMs = 8_000): Promise<string | null> {
  try {
    let current = new URL(imageUrl);
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      if (current.protocol !== "https:" && current.protocol !== "http:") return null;
      await assertPublicHost(current.hostname);
      const res = await fetch(current, { headers: { "User-Agent": UA, Accept: "image/jpeg,image/png,image/webp,*/*;q=0.5" }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current);
        continue;
      }
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!/^image\/(jpeg|png|webp)/.test(type)) return null;
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > MAX_BYTES) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) return null;
      const jpg = await sharp(buf, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).normalise({ lower: 2, upper: 98 }).sharpen({ sigma: 0.6 }).jpeg({ quality: 88 }).toBuffer();
      const blob = await put(`merchant/${tenantId}${SOURCE_IMAGE_MARK}${Date.now()}.jpg`, jpg, { access: "public", contentType: "image/jpeg", addRandomSuffix: true, allowOverwrite: false });
      return blob.pathname;
    }
    return null;
  } catch (e) {
    console.error("[cards] source image failed:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}
