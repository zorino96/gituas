// Writing one draft, start to finish: the desk's voice, the source-copy retries and
// the cross-desk check. The editor's action calls it, and so does the autopilot.
import type { Strength } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { draftFor, nextAttempt, RETRY_DEADLINE_MS, type DraftOptions } from "./draft";
import { copyPart, type CopyPart } from "./rules";
import type { Draft } from "./types";
import { sameStoryTooClose, voiceFor } from "./voice";

export interface WriteItem {
  url: string;
  sourceName: string;
  title: string;
  snippet: string;
}

export interface Written {
  draft: Draft;
  model: string;
  /** What still copies the source after every retry; null when the draft is clean. */
  part: CopyPart;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when another desk already holds a draft of this same article that reads like ours.
 * The other desks' text is only compared here, on the server: it is never returned, never
 * shown and never given to the model.
 */
async function readsLikeAnotherDesk(tenantId: string, url: string, ours: { headline: string; body: string }): Promise<boolean> {
  const others = await db.newsDraft.findMany({
    where: { tenantId: { not: tenantId }, item: { url }, updatedAt: { gte: new Date(Date.now() - WEEK_MS) } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { headline: true, body: true },
  });
  return others.some((o) => sameStoryTooClose(ours, o));
}

/**
 * Draft the item in the desk's own voice. A draft that copies the source is redrafted with
 * feedback (same strength), and once more at "strong" if a "fast" draft still copies. A draft
 * that reads like another desk's draft of the same article is then written once more, with
 * our own draft as the wording to move away from. All of it stays inside the deadline counted
 * from `startedAt`. The caller counts usage: one user action is one count, whatever the
 * number of attempts here.
 */
export async function writeDraft(
  tenantId: string,
  item: WriteItem,
  strength: Strength,
  opts: { startedAt: number; voiceNote?: string | null },
): Promise<Written> {
  const style: DraftOptions = { voice: voiceFor(tenantId), voiceNote: opts.voiceNote };
  let attempt = 1;
  let currentStrength: Strength = strength;
  let result = await draftFor(item, currentStrength, undefined, style);
  let part = copyPart(result.draft, item);
  for (;;) {
    const next = nextAttempt(attempt, currentStrength, part, Date.now() - opts.startedAt);
    if (next === null) break;
    const feedback = {
      headline: part !== "body" ? result.draft.headline : undefined,
      body: part !== "headline" ? result.draft.body : undefined,
    };
    currentStrength = next;
    attempt++;
    result = await draftFor(item, currentStrength, feedback, style);
    part = copyPart(result.draft, item);
  }

  // The cross-desk check is a refinement: when it cannot run, the draft we have stands.
  try {
    if (Date.now() - opts.startedAt <= RETRY_DEADLINE_MS && (await readsLikeAnotherDesk(tenantId, item.url, result.draft))) {
      const ours = { headline: result.draft.headline, body: result.draft.body };
      const again = await draftFor(item, currentStrength, undefined, { ...style, avoid: ours });
      const againPart = copyPart(again.draft, item);
      // Keep the rewrite, even if it is still close, unless it copies the source where the first did not.
      if (againPart === null || part !== null) {
        result = again;
        part = againPart;
      }
    }
  } catch {
    // Keep the first draft.
  }
  return { draft: result.draft, model: result.model, part };
}
