// The composer's work, kept in this browser so that leaving the publish page loses nothing.
// One draft per workspace (a shop or a news desk). The photo or video is already in Vercel Blob
// by the time it is kept, so the draft holds its link, never the file. Storage can be missing or
// throw (private windows, blocked site data); every call here survives that and simply keeps nothing.

import { isOwnBlobUrl, type Target } from "@/lib/merchant/caption";

export interface PublishDraft {
  caption: string;
  media: { url: string; pathname: string; type: "IMAGE" | "VIDEO"; durationSec?: number } | null;
  targets: Target[];
  productId: string;
  mode: "now" | "later";
  runAtLocal: string;
  savedAt: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A draft older than this is dropped rather than restored. */
export const DRAFT_MAX_AGE_MS = 14 * 86_400_000;

const TARGETS: readonly Target[] = ["FB", "IG", "TT", "YT"];

export function draftKey(workspaceId: string): string {
  return `gm_publish_draft:${workspaceId}`;
}

/** This browser's localStorage, or null where there is none or it may not be touched. */
export function browserStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Worth keeping: there is some text or a finished upload. */
export function hasContent(d: Pick<PublishDraft, "caption" | "media">): boolean {
  return !!d.caption.trim() || !!d.media;
}

/** The workspace's draft, or null when there is none, it is too old, or it is not one of ours. */
export function readDraft(store: Store | null, workspaceId: string, now: number = Date.now()): PublishDraft | null {
  try {
    const raw = store?.getItem(draftKey(workspaceId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<PublishDraft>;
    if (typeof d.savedAt !== "number" || now - d.savedAt > DRAFT_MAX_AGE_MS) return null;
    if (typeof d.caption !== "string" || typeof d.productId !== "string" || typeof d.runAtLocal !== "string") return null;
    if (d.mode !== "now" && d.mode !== "later") return null;
    if (!Array.isArray(d.targets) || !d.targets.every((x) => TARGETS.includes(x))) return null;
    let media: PublishDraft["media"] = null;
    if (d.media) {
      const m = d.media;
      // Only media this workspace uploaded to our own Blob store, so a stale or tampered entry cannot be published.
      if (typeof m.url !== "string" || !isOwnBlobUrl(m.url, workspaceId)) return null;
      if (typeof m.pathname !== "string" || !m.pathname.startsWith(`merchant/${workspaceId}/`)) return null;
      if (m.type !== "IMAGE" && m.type !== "VIDEO") return null;
      media = { url: m.url, pathname: m.pathname, type: m.type, ...(typeof m.durationSec === "number" ? { durationSec: m.durationSec } : {}) };
    }
    const draft: PublishDraft = { caption: d.caption, media, targets: d.targets, productId: d.productId, mode: d.mode, runAtLocal: d.runAtLocal, savedAt: d.savedAt };
    return hasContent(draft) ? draft : null;
  } catch {
    return null;
  }
}

/** Keep the draft, or forget it when there is nothing left worth keeping. */
export function writeDraft(store: Store | null, workspaceId: string, d: PublishDraft): void {
  try {
    if (hasContent(d)) store?.setItem(draftKey(workspaceId), JSON.stringify(d));
    else store?.removeItem(draftKey(workspaceId));
  } catch {
    // Full or blocked storage: the composer still works, it just won't remember.
  }
}

export function clearDraft(store: Store | null, workspaceId: string): void {
  try {
    store?.removeItem(draftKey(workspaceId));
  } catch {
    // Nothing to do.
  }
}
