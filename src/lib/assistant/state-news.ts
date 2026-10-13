// What the newsroom's assistant may know about the asking desk: settings and counts only, read for this workspace.
// No story text, no comment or message, no connection token, nothing about payments.

import { imageEnabled } from "@/lib/ai/image";
import { db } from "@/lib/db";
import { FRAME_SECTIONS } from "@/lib/news/frames-shared";

const PROMPT_SHOWN = 300;

export async function loadNewsAssistantState(tenantId: string, names: { desk: string; sections: Record<string, string> }) {
  const [kit, frames, settings, photos] = await Promise.all([
    db.brandKit.findUnique({ where: { tenantId }, select: { logoPath: true, framePath: true, frameText: true } }),
    db.newsFrame.findMany({ where: { tenantId }, select: { section: true, frameText: true, referencePath: true } }),
    db.newsSettings.findUnique({ where: { tenantId }, select: { designPrompt: true, autoMode: true, filterMode: true } }),
    db.newsPhoto.count({ where: { tenantId } }),
  ]);
  const own = new Map(frames.map((x) => [x.section, x]));
  return {
    desk: names.desk,
    brand: {
      logo: !!kit?.logoPath,
      mainFrame: !!kit?.framePath,
      mainFrameHeadline: kit?.frameText ?? "bottom",
      photosInLibrary: photos,
    },
    // Every section the desk can give a frame to, and whether it has one.
    frames: FRAME_SECTIONS.map((s) => ({
      section: s,
      name: names.sections[s] ?? s,
      ownFrame: own.has(s),
      headline: own.get(s)?.frameText,
    })),
    designPrompt: settings?.designPrompt ? settings.designPrompt.slice(0, PROMPT_SHOWN) : null,
    aiFramesAvailable: imageEnabled(),
    autopilot: settings?.autoMode ?? "OFF",
    sourceFilter: settings?.filterMode ?? "KEYWORDS",
  };
}
