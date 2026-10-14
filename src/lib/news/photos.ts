// A desk's photo library for card backgrounds (see clips.ts for how picking works).
// With an outlet frame (BrandKit.framePath) the card is this photo behind the frame.

import { db } from "@/lib/db";
import { isOwnPathname } from "@/lib/merchant/caption";
import { pickFromLibrary, shuffled } from "./clips";
import { aiPictureForStory } from "./ai-picture";
import { storeSourceImage } from "./source-image";

/** Most photos one desk keeps in its library. */
export const PHOTO_LIBRARY_MAX = 200;

/** A photo pathname this desk may use: its own Blob file, an image. */
export function isOwnPhoto(tenantId: string, pathname: unknown): pathname is string {
  return isOwnPathname(pathname, tenantId) && /\.(jpe?g|png|webp)$/i.test(pathname);
}

/**
 * The photo for one story's card, or null for none. In order: a library photo whose label fits the story; the story's
 * own picture from its feed (only when the desk turned that on); a general library photo. Never throws.
 */
export async function photoForStory(
  tenantId: string,
  story: { title: string; snippet: string; imageUrl?: string | null },
  budgetMs?: number,
): Promise<string | null> {
  try {
    const library = await db.newsPhoto.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, pathname: true, label: true, general: true } });
    const labelled = library.filter((p) => !p.general);
    if (labelled.length) {
      const [picked] = await pickFromLibrary(story, labelled, 1, budgetMs);
      const fit = library.find((p) => p.id === picked);
      if (fit && isOwnPhoto(tenantId, fit.pathname)) return fit.pathname;
    }
    const s = await db.newsSettings.findUnique({ where: { tenantId }, select: { sourceImages: true, aiPictures: true } });
    if (story.imageUrl && s?.sourceImages) {
      const own = await storeSourceImage(tenantId, story.imageUrl);
      if (own) return own;
    }
    if (s?.aiPictures) {
      const made = await aiPictureForStory(tenantId, story, budgetMs === undefined ? 40_000 : Math.min(40_000, budgetMs));
      if (made) return made;
    }
    const general = shuffled(library.filter((p) => p.general))[0];
    return general && isOwnPhoto(tenantId, general.pathname) ? general.pathname : null;
  } catch (e) {
    console.error("[cards] photo pick failed:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}
