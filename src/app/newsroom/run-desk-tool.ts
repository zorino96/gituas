// A news desk's confirmed frame tools (a section's frame, where its headline goes, the desk's words about its graphics), run for
// real. A plain module, NOT "use server": the exports of a server-action file become public endpoints, and these must only be
// called from code that already checked the session, the role and that the card was confirmed.
//
// Two callers share it: runToolAction (the classic assistant screen) and the chat's write tools (src/lib/chat/tools/writes-news-brand.ts).
// Each tool goes through the same server action the Brand & photos screen uses, with that action's own checks (role, allowance, the
// desk's own files only); the reference is one of the pictures attached in the chat.

import {
  designSectionFrameAction,
  removeSectionFrameAction,
  saveDesignPromptAction,
  saveSectionFrameTextAction,
} from "@/app/newsroom/(desk)/news/actions";
import { imageEnabled } from "@/lib/ai/image";
import { NEWS_TOOLS, type ToolName } from "@/lib/assistant/tools";
import { isFrameText, type FrameText } from "@/lib/cards/brand";
import type { ChatAttachment } from "@/lib/chat/types";
import { db } from "@/lib/db";
import type { dict } from "@/lib/i18n";
import { isFrameSection } from "@/lib/news/frames-shared";

export type DeskToolResult = { ok: true; text: string } | { ok: false; error: string };

type Dictionary = ReturnType<typeof dict>;

/**
 * What a new design of a section's frame is given: the reference graphic, the note and where the headline goes. A design keeps the
 * reference and the note the section already had unless new ones are given, and the headline place it already has, else the main
 * frame's. `*Kept` says which values came from before (a card shows them as kept).
 */
export type FrameDesign =
  | { ok: true; section: string; referencePath: string | null; referenceKept: boolean; note: string; noteKept: boolean; frameText: FrameText }
  | { ok: false; error: string };

export async function frameDesignOf(tenantId: string, args: Record<string, unknown>, atts: ChatAttachment[], t: Dictionary): Promise<FrameDesign> {
  const n = t.assistant.news;
  const section = String(args.section ?? "");
  if (!isFrameSection(section)) return { ok: false, error: n.errors.badSection };
  let referencePath: string | null = null;
  if (typeof args.reference === "string") {
    const f = atts.find((x) => x.id === args.reference);
    if (!f || f.kind !== "image" || !/\.(png|jpe?g|webp)$/i.test(f.pathname)) return { ok: false, error: n.errors.badReference };
    referencePath = f.pathname;
  }
  // Where the headline goes: what was asked for, else what this section has now, else the main frame's.
  let position: FrameText | null = isFrameText(args.position) ? args.position : null;
  if (!position) {
    const cur = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId, section } }, select: { frameText: true } });
    position = isFrameText(cur?.frameText) ? cur.frameText : null;
  }
  if (!position) {
    const kit = await db.brandKit.findUnique({ where: { tenantId }, select: { frameText: true } });
    position = isFrameText(kit?.frameText) ? kit.frameText : "bottom";
  }
  // A new design of a section keeps the reference and the note it already had unless new ones are given.
  let note = String(args.note ?? "");
  let referenceKept = false;
  let noteKept = false;
  if (!referencePath || !note) {
    const prev = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId, section } }, select: { referencePath: true, note: true } });
    if (!referencePath && prev?.referencePath) {
      referencePath = prev.referencePath;
      referenceKept = true;
    }
    if (!note && prev?.note) {
      note = prev.note;
      noteKept = true;
    }
  }
  return { ok: true, section, referencePath, referenceKept, note, noteKept, frameText: position };
}

/** Runs one of the desk's confirmed frame tools through the same server action the Brand & photos screen uses. */
export async function runDeskTool(tenantId: string, tool: ToolName, args: Record<string, unknown>, atts: ChatAttachment[], t: Dictionary): Promise<DeskToolResult> {
  const a = t.assistant;
  const n = a.news;
  if (!(NEWS_TOOLS as readonly string[]).includes(tool)) return { ok: false, error: a.errors.badAction };
  const section = String(args.section ?? "");
  if (tool !== "set_design_prompt" && !isFrameSection(section)) return { ok: false, error: n.errors.badSection };

  switch (tool) {
    case "design_section_frame": {
      if (!imageEnabled()) return { ok: false, error: n.errors.featureOff };
      const design = await frameDesignOf(tenantId, args, atts, t);
      if (!design.ok) return design;
      const r = await designSectionFrameAction({ section, referencePath: design.referencePath, note: design.note, frameText: design.frameText });
      return r.ok ? { ok: true, text: n.done.frame } : { ok: false, error: r.error };
    }
    case "set_design_prompt": {
      const r = await saveDesignPromptAction(String(args.text ?? ""));
      return r.ok ? { ok: true, text: r.designPrompt ? n.done.prompt : n.done.promptCleared } : { ok: false, error: r.error };
    }
    case "set_frame_text": {
      const pos = args.position;
      if (!isFrameText(pos)) return { ok: false, error: a.errors.badAction };
      const own = await db.newsFrame.findUnique({ where: { tenantId_section: { tenantId, section } }, select: { id: true } });
      if (!own) return { ok: false, error: n.errors.noFrame };
      const r = await saveSectionFrameTextAction(section, pos);
      return r.ok ? { ok: true, text: n.done.position } : { ok: false, error: r.error };
    }
    case "remove_section_frame": {
      const r = await removeSectionFrameAction(section);
      return r.ok ? { ok: true, text: n.done.removed } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: a.errors.badAction };
  }
}
