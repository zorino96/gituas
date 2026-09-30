import type { FbElement } from "./compose";
import type { MetaMessage, MetaPlatform } from "./meta-client";
import type { CommentDecision, DmAction } from "./policy";

export type OutboxKind = "PUBLIC_REPLY" | "PRIVATE_REPLY" | "LIKE" | "HIDE" | "DM_ANSWER" | "DM_PHOTOS";

export interface JobPayload {
  commentId?: string;
  text?: string;
  message?: MetaMessage;
  /** Facebook private reply: sent as text if the template is rejected. */
  fallbackText?: string;
  recipientId?: string;
  urls?: string[];
}

export interface JobSpec {
  kind: OutboxKind;
  payload: JobPayload;
  recipientId?: string;
}

const ORDER: OutboxKind[] = ["PUBLIC_REPLY", "LIKE", "PRIVATE_REPLY", "HIDE"];

export function buildCommentJobs(i: {
  decision: CommentDecision;
  platform: MetaPlatform;
  commentId: string;
  authorName: string | null;
  publicText: string | null;
  card: { text: string; elements: FbElement[] } | null;
  defaultDm: string | null;
}): JobSpec[] {
  const out: JobSpec[] = [];
  for (const a of i.decision.actions) {
    if (a.kind === "PUBLIC_REPLY") {
      if (!i.publicText) continue;
      const mention = i.platform === "META_INSTAGRAM" && i.authorName ? `@${i.authorName} ` : "";
      out.push({ kind: "PUBLIC_REPLY", payload: { commentId: i.commentId, text: mention + i.publicText } });
    } else if (a.kind === "LIKE" || a.kind === "HIDE") {
      out.push({ kind: a.kind, payload: { commentId: i.commentId } });
    } else if (a.content === "card" && i.card) {
      const message: MetaMessage =
        i.platform === "META_FACEBOOK" && i.card.elements.length
          ? { attachment: { type: "template", payload: { template_type: "generic", elements: i.card.elements } } }
          : { text: i.card.text };
      out.push({ kind: "PRIVATE_REPLY", payload: { commentId: i.commentId, message, fallbackText: i.card.text } });
    } else if (a.content === "default_dm" && i.defaultDm?.trim()) {
      out.push({ kind: "PRIVATE_REPLY", payload: { commentId: i.commentId, message: { text: i.defaultDm.trim() } } });
    }
  }
  return out.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
}

export function buildDmJobs(i: { actions: DmAction[]; recipientId: string; photos: string[]; answerText: string | null }): JobSpec[] {
  const out: JobSpec[] = [];
  for (const a of i.actions) {
    if (a.kind === "DM_PHOTOS" && i.photos.length) {
      out.push({ kind: "DM_PHOTOS", payload: { recipientId: i.recipientId, urls: i.photos.slice(0, 5) }, recipientId: i.recipientId });
    } else if (a.kind === "DM_ANSWER" && i.answerText) {
      out.push({ kind: "DM_ANSWER", payload: { recipientId: i.recipientId, message: { text: i.answerText } }, recipientId: i.recipientId });
    }
  }
  return out;
}
