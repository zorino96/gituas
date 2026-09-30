export type GateReason =
  | "self" | "store_off" | "store_paused" | "no_post" | "post_off" | "post_expired"
  | "post_before_stop" | "post_slots" | "thread_paused" | "author_limit" | "daily_cap";

export type GateResult = { ok: true } | { ok: false; reason: GateReason };

interface StoreSwitches {
  automationEnabled: boolean;
  pausedReason: string | null;
  stopBefore: Date | null;
}

export interface GateInput {
  now: Date;
  store: StoreSwitches;
  /** The store's own Page / Instagram ids and Instagram username. */
  self: { ids: string[]; username: string | null };
  author: { id: string | null; name: string | null };
  post: { enabled: boolean; activeUntil: Date; postCreatedAt: Date } | null;
  /** Enabled, unexpired automated posts of this store that are newer than this one. */
  newerAutomatedPosts: number;
  /** The plan's post slots; null means every post. */
  postSlots: number | null;
  repliedToAuthorOnPostToday: boolean;
  threadPaused: boolean;
  sentToday: number;
  dailyCap: number;
}

const no = (reason: GateReason): GateResult => ({ ok: false, reason });

/** Whether a comment may be automated. The self check comes first: the shop must never answer itself. */
export function gate(i: GateInput): GateResult {
  const selfName = i.self.username?.toLowerCase();
  if ((i.author.id && i.self.ids.includes(i.author.id)) || (selfName && i.author.name?.toLowerCase() === selfName)) return no("self");
  if (!i.store.automationEnabled) return no("store_off");
  if (i.store.pausedReason) return no("store_paused");
  if (!i.post) return no("no_post");
  if (!i.post.enabled) return no("post_off");
  if (i.post.activeUntil.getTime() <= i.now.getTime()) return no("post_expired");
  if (i.store.stopBefore && i.post.postCreatedAt < i.store.stopBefore) return no("post_before_stop");
  if (i.postSlots != null && i.newerAutomatedPosts >= i.postSlots) return no("post_slots");
  if (i.threadPaused) return no("thread_paused");
  if (i.repliedToAuthorOnPostToday) return no("author_limit");
  if (i.sentToday >= i.dailyCap) return no("daily_cap");
  return { ok: true };
}

export interface DmGateInput {
  store: StoreSwitches;
  threadPaused: boolean;
  sentToday: number;
  dailyCap: number;
}

export function gateDm(i: DmGateInput): GateResult {
  if (!i.store.automationEnabled) return no("store_off");
  if (i.store.pausedReason) return no("store_paused");
  if (i.threadPaused) return no("thread_paused");
  if (i.sentToday >= i.dailyCap) return no("daily_cap");
  return { ok: true };
}
