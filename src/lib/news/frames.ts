// A desk's frames by section, from the database (the rules are in frames-shared.ts, which the screens use as well).

import { brandFrom, type Brand } from "@/lib/cards/brand";
import { db } from "@/lib/db";
import { brandWithFrame, type FrameRow } from "./frames-shared";

export * from "./frames-shared";

export async function loadFrames(tenantId: string): Promise<FrameRow[]> {
  // A card must still be made when the frames cannot be read: it falls back to the main frame.
  return db.newsFrame.findMany({ where: { tenantId }, select: { section: true, framePath: true, frameText: true } }).catch(() => []);
}

/** The brand a card is drawn with: the desk's brand kit, with the section's frame in place of the main one when it has one. */
export function brandForStory(
  kit: Parameters<typeof brandFrom>[0],
  pageName: string,
  frames: readonly FrameRow[],
  cardKind: string,
  category: string | null,
): Brand {
  return brandWithFrame(brandFrom(kit, pageName), frames, cardKind, category);
}
