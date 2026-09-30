import type { Lang } from "./money";

export type CommentType = "QUESTION" | "ORDER" | "PRAISE" | "NEGOTIATION" | "COMPLAINT" | "ABUSE" | "SPAM" | "OTHER";
export type Intent = "price" | "delivery" | "size_colour" | "address" | "hours" | "availability" | "none";
export const COMMENT_TYPES: readonly CommentType[] = ["QUESTION", "ORDER", "PRAISE", "NEGOTIATION", "COMPLAINT", "ABUSE", "SPAM", "OTHER"];
export const INTENTS: readonly Intent[] = ["price", "delivery", "size_colour", "address", "hours", "availability", "none"];

export interface Classification {
  type: CommentType;
  intent: Intent;
  language: Lang;
  confidence: number;
}

/** Below this the shop stays silent and asks the merchant. */
export const MIN_CONFIDENCE = 0.6;

export type CommentAction =
  | { kind: "PUBLIC_REPLY"; style: "answer" | "thanks" }
  | { kind: "PRIVATE_REPLY"; content: "card" | "default_dm"; whatsapp: boolean }
  | { kind: "LIKE" }
  | { kind: "HIDE" };

export interface CommentDecision {
  actions: CommentAction[];
  /** Non-null: the merchant should look at this one ("needs you"). */
  flag: string | null;
}

export interface CommentContext {
  hasProduct: boolean;
  hasDefaultDm: boolean;
  likeComments: boolean;
  autoHideSpam: boolean;
  isFacebook: boolean;
  whatsappAlways: boolean;
  /** Meta allows one private reply per comment, within 7 days of it. */
  canPrivateReply: boolean;
}

export function decideComment(c: Classification, ctx: CommentContext): CommentDecision {
  if (c.confidence < MIN_CONFIDENCE) return { actions: [], flag: "low_confidence" };
  const like: CommentAction[] = ctx.isFacebook && ctx.likeComments ? [{ kind: "LIKE" }] : [];

  if (c.type === "QUESTION" || c.type === "ORDER") {
    // The public "answer" tells the buyer to check their messages, so it only goes out together with a private reply.
    if (!ctx.canPrivateReply) return { actions: [...like], flag: "private_window" };
    let priv: CommentAction;
    if (ctx.hasProduct) {
      priv = { kind: "PRIVATE_REPLY", content: "card", whatsapp: c.type === "ORDER" || ctx.whatsappAlways };
    } else if (ctx.hasDefaultDm) {
      priv = { kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false };
    } else {
      return { actions: [...like], flag: "no_product" };
    }
    return { actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, priv, ...like], flag: null };
  }
  if (c.type === "PRAISE") return { actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, ...like], flag: null };
  if (c.type === "SPAM" || c.type === "ABUSE") {
    return { actions: ctx.autoHideSpam ? [{ kind: "HIDE" }] : [], flag: c.type.toLowerCase() };
  }
  return { actions: [], flag: c.type.toLowerCase() };
}

export type DmAction = { kind: "DM_PHOTOS" } | { kind: "DM_ANSWER"; intent: Intent; whatsapp: boolean };

export interface DmContext {
  /** The thread began with a product card, so we know what the buyer is asking about. */
  boundProduct: boolean;
  /** No photos have been sent to this buyer yet. */
  firstReply: boolean;
  hasPhotos: boolean;
}

const CARD_ANSWERS: readonly Intent[] = ["price", "delivery", "size_colour", "availability"];

export function decideDm(c: Classification | null, ctx: DmContext): { actions: DmAction[]; flag: string | null } {
  if (!ctx.boundProduct) return { actions: [], flag: "no_product" };
  const photos: DmAction[] = ctx.firstReply && ctx.hasPhotos ? [{ kind: "DM_PHOTOS" }] : [];
  if (!c) return { actions: photos, flag: "unclear" };
  if (c.confidence < MIN_CONFIDENCE) return { actions: photos, flag: "low_confidence" };
  if (c.type === "ORDER") return { actions: [...photos, { kind: "DM_ANSWER", intent: c.intent, whatsapp: true }], flag: null };
  if (c.type === "QUESTION") {
    return CARD_ANSWERS.includes(c.intent)
      ? { actions: [...photos, { kind: "DM_ANSWER", intent: c.intent, whatsapp: false }], flag: null }
      : { actions: photos, flag: "needs_you" };
  }
  if (c.type === "PRAISE") return { actions: photos, flag: null };
  return { actions: photos, flag: c.type.toLowerCase() };
}

/** An author already answered on this post today: never reply again, but still hide spam and flag what needs the merchant. */
export function limitDecision(d: CommentDecision): CommentDecision {
  return { actions: d.actions.filter((a) => a.kind === "HIDE"), flag: d.flag };
}
