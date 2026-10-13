// A desk's frames by section: the part that needs no database, so the editor and the settings screen can use it too.
//
// The desk has one main frame (BrandKit.framePath) for every card, and may give any section its own: a card of an
// economy story is the story photo behind the economy frame, a breaking card behind the breaking frame, and a section
// without a frame uses the main one. The sections are exactly the options of the source filter (the taxonomy) plus
// "breaking", which is a kind of card rather than a topic.

import { isFrameText, type Brand } from "@/lib/cards/brand";
import { mediaSrc } from "@/lib/cards/brand";
import { TAXONOMY, type CategoryId } from "./taxonomy";

export const FRAME_SECTIONS = ["breaking", ...TAXONOMY.map((c) => c.id)] as readonly string[];
export type FrameSection = "breaking" | CategoryId;

export const isFrameSection = (v: unknown): v is FrameSection => typeof v === "string" && FRAME_SECTIONS.includes(v);

/** The drafts keep a Sorani label for their category; the stories keep the taxonomy id. This maps the label back. */
const FROM_LABEL: Record<string, CategoryId> = {
  "سیاسەت": "politics",
  "ئابووری": "economy",
  "ئاسایش": "security",
  "وەرزش": "sports",
  "تەندروستی": "health",
  "کۆمەڵایەتی": "society",
  "تەکنەلۆژیا": "tech",
  "جیهان": "other",
  "گشتی": "other",
};

/** The taxonomy category of a story: its own id when it has one, else the draft's label mapped back. */
export function categoryOfStory(itemCategory: string | null | undefined, draftLabel?: string | null): CategoryId | null {
  if (itemCategory && TAXONOMY.some((c) => c.id === itemCategory)) return itemCategory as CategoryId;
  if (draftLabel && FROM_LABEL[draftLabel]) return FROM_LABEL[draftLabel];
  return null;
}

export interface FrameRow {
  section: string;
  framePath: string;
  frameText: string;
}

/** The frame for a card: its section's own (breaking first), or null when the desk's main frame is to be used. */
export function frameFor(frames: readonly FrameRow[], cardKind: string, category: string | null): FrameRow | null {
  if (cardKind === "BREAKING") {
    const b = frames.find((f) => f.section === "breaking");
    if (b) return b;
  }
  return (category && frames.find((f) => f.section === category)) || null;
}

/** The card's brand with the section's frame in place of the main one when it has one. */
export function brandWithFrame(base: Brand, frames: readonly FrameRow[], cardKind: string, category: string | null): Brand {
  const own = frameFor(frames, cardKind, category);
  if (!own) return base;
  return { ...base, frameSrc: mediaSrc(own.framePath), frameText: isFrameText(own.frameText) ? own.frameText : "bottom" };
}
