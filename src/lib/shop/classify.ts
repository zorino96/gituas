import { completeJson } from "@/lib/ai/provider";
import { LANGS, type Lang } from "./money";
import { COMMENT_TYPES, INTENTS, type Classification, type CommentType, type Intent } from "./policy";

export const CLASSIFY_SYSTEM = `You label comments and direct messages that buyers send to small shops in Iraqi Kurdistan on Facebook and Instagram.
Return JSON only: {"type": "...", "intent": "...", "language": "...", "confidence": 0.0-1.0}. Never write anything else.

type:
- QUESTION: asks about the product — price, size, colour, delivery, where the shop is, whether it is available. e.g. "چەندە؟", "بە چەندە", "قیاسی L هەیە؟", "بكم", "شكد السعر", "گەیاندنتان هەیە بۆ دهۆک؟", "price?"
- ORDER: wants to buy or asks how to order. e.g. "دەمەوێت", "یەکێکم بۆ بنێرە", "اريد واحد", "ez dixwazim"
- PRAISE: praise, thanks, emoji only, or tagging a friend with no question. e.g. "زۆر جوانە", "😍😍", "@aram"
- NEGOTIATION: asks for a discount or haggles. e.g. "هەرزانتری نییە؟", "خصم؟"
- COMPLAINT: a problem with an order or the shop, or doubts that the product is genuine.
- ABUSE: insults or harassment.
- SPAM: ads, links, other sellers, scams.
- OTHER: anything else.

intent — for QUESTION and ORDER only, otherwise "none": price | delivery | size_colour | address | hours | availability | none

language: ckb = Central Kurdish (Sorani) in Arabic script; kmr = Badini (Northern Kurdish) in Arabic script; ar = Arabic; ku_latn = Kurdish in Latin letters; en = English. Emoji only: "ckb".

confidence: how sure you are about "type".`;

export function parseClassification(d: unknown): Classification | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const intent = o.intent ?? "none";
  const confidence = typeof o.confidence === "number" ? o.confidence : NaN;
  if (!COMMENT_TYPES.includes(o.type as CommentType)) return null;
  if (!INTENTS.includes(intent as Intent)) return null;
  if (!LANGS.includes(o.language as Lang)) return null;
  if (!Number.isFinite(confidence)) return null;
  return { type: o.type as CommentType, intent: intent as Intent, language: o.language as Lang, confidence: Math.min(1, Math.max(0, confidence)) };
}

/** Labels only — the model never writes text for the buyer here. Null on empty input or any failure. */
export async function classifyText(text: string, ctx: { channel: "comment" | "dm"; productName?: string }): Promise<Classification | null> {
  const t = text.trim().slice(0, 600);
  if (!t) return null;
  const about = ctx.productName ? ` on a post about: ${ctx.productName.slice(0, 80)}` : "";
  const user = `${ctx.channel === "dm" ? "Direct message" : "Comment"}${about}\n"""${t}"""`;
  try {
    return (await completeJson({ system: CLASSIFY_SYSTEM, user, strength: "fast", thinking: false }, parseClassification)).data;
  } catch {
    return null;
  }
}
