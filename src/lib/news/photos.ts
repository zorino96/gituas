// A desk's photo library for card backgrounds (see clips.ts for how picking works).
// With an outlet frame (BrandKit.framePath) the card is this photo behind the frame.

import { db } from "@/lib/db";
import { pickFromLibrary, shuffled } from "./clips";

/** Most photos one desk keeps in its library. */
export const PHOTO_LIBRARY_MAX = 200;

/** A photo pathname this desk may use: its own Blob file, an image. */
export function isOwnPhoto(tenantId: string, pathname: unknown): pathname is string {
  return (
    typeof pathname === "string" &&
    pathname.startsWith(`merchant/${tenantId}/`) &&
    !pathname.includes("..") &&
    /\.(jpe?g|png|webp)$/i.test(pathname)
  );
}

/** The library photo for one story's card, or null for none. Never throws. */
export async function photoForStory(tenantId: string, story: { title: string; snippet: string }, budgetMs?: number): Promise<string | null> {
  try {
    const library = await db.newsPhoto.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, select: { id: true, pathname: true, label: true, general: true } });
    if (!library.length) return null;
    const [picked] = await pickFromLibrary(story, library.filter((p) => !p.general), 1, budgetMs);
    const chosen = library.find((p) => p.id === picked) ?? shuffled(library.filter((p) => p.general))[0];
    return chosen && isOwnPhoto(tenantId, chosen.pathname) ? chosen.pathname : null;
  } catch (e) {
    console.error("[cards] photo pick failed:", e instanceof Error ? e.message : "unknown error");
    return null;
  }
}
