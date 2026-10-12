// The database side of smart replies: what the assistant is told about the shop, the plan's monthly
// allowance, and the chat so far. The writing and the checking are in ./smart.ts.

import { db } from "@/lib/db";
import { cityLabel } from "@/lib/orders/cities";
import { cityFees, COPY, deliveryLine, type CardProduct, type CardStore } from "./compose";
import { formatMoney, type Lang } from "./money";
import { SHOP_LIMITS, type StorePlan } from "./plans";
import { countSmart, smartUsed } from "./quota";
import { smartReply, type SmartFacts, type SmartKind, type SmartOutput, type SmartProduct } from "./smart";

const DAY = 86_400_000;
const CATALOG_MAX = 10;

/** A product as the assistant is told about it: the name and the prices exactly as the shop shows them. */
export function productFacts(p: CardProduct, lang: Lang): SmartProduct {
  const c = COPY[lang];
  const price = (v: CardProduct["variants"][number]) => (v.inStock ? formatMoney(v.amountMinor, v.currency, lang) : c.soldOut);
  const single = p.variants.length === 1 && !p.variants[0].label.trim();
  return { name: p.name, lines: single ? [price(p.variants[0])] : p.variants.map((v) => `${v.label}: ${price(v)}`) };
}

const cityLang = (lang: Lang) => (lang === "ar" ? "ar" : lang === "en" || lang === "ku_latn" ? "en" : "ckb");

/** The shop's delivery terms as lines: the general fee and time, then each city that has its own fee. */
export function deliveryFacts(s: CardStore, lang: Lang): string[] {
  const out: string[] = [];
  const general = deliveryLine(s, lang);
  if (general) out.push(general);
  for (const [city, minor] of Object.entries(cityFees(s))) {
    out.push(`${cityLabel(city, cityLang(lang))}: ${minor === 0 ? COPY[lang].freeDelivery : formatMoney(minor, s.deliveryCurrency, lang)}`);
  }
  return out;
}

export interface SmartStore extends CardStore {
  id: string;
  tenantId: string;
  name: string;
  plan: string;
  aiReplies: boolean;
  aiBrief: string | null;
  defaultDm?: string | null;
}

export interface SmartContext {
  store: SmartStore;
  kind: SmartKind;
  lang: Lang;
  /** The buyer's comment or message. */
  message: string;
  product: (CardProduct & { id: string }) | null;
  /** The order link a reply may carry. */
  waLink: string | null;
  /** The buyer's id in this chat, to fetch the earlier turns. */
  senderId?: string | null;
  /** This message itself (already stored), left out of the earlier turns. */
  messageId?: string;
  /** The message is a voice note, read by speech recognition. */
  viaVoice?: boolean;
}

async function catalog(storeId: string, exceptId: string | null, lang: Lang): Promise<SmartProduct[]> {
  const rows = await db.product.findMany({
    where: { storeId, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: CATALOG_MAX,
    include: { variants: { orderBy: { position: "asc" } } },
  });
  return rows.map((p) =>
    productFacts({ name: p.name, photos: [], variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })) }, lang),
  );
}

/** The earlier turns of this buyer's chat, oldest first: what they wrote and what the shop sent back. */
async function history(storeId: string, senderId: string, exceptId: string | undefined): Promise<{ from: "buyer" | "shop"; text: string }[]> {
  const since = new Date(Date.now() - 3 * DAY);
  const [inbound, outbound] = await Promise.all([
    db.conversationMessage.findMany({
      where: { storeId, authorId: senderId, direction: "INBOUND", channelType: "DM", createdAt: { gt: since }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { content: true, createdAt: true },
    }),
    db.outboxJob.findMany({
      where: { storeId, recipientId: senderId, status: "SENT", kind: { in: ["PRIVATE_REPLY", "DM_ANSWER"] }, updatedAt: { gt: since } },
      orderBy: { updatedAt: "desc" },
      take: 4,
      select: { payload: true, updatedAt: true },
    }),
  ]);
  const turns: { at: number; from: "buyer" | "shop"; text: string }[] = [];
  for (const m of inbound) if (m.content?.trim()) turns.push({ at: m.createdAt.getTime(), from: "buyer", text: m.content.trim() });
  for (const j of outbound) {
    const p = (j.payload ?? {}) as { message?: { text?: unknown }; fallbackText?: unknown };
    const text = typeof p.message?.text === "string" ? p.message.text : typeof p.fallbackText === "string" ? p.fallbackText : "";
    if (text.trim()) turns.push({ at: j.updatedAt.getTime(), from: "shop", text: text.trim() });
  }
  return turns.sort((a, b) => a.at - b.at).map(({ from, text }) => ({ from, text }));
}

/**
 * One smart reply for this situation, or null: smart replies are off, the month's allowance is used,
 * or the model failed the guard. The caller then falls back to the fixed templates.
 */
export async function smartTry(ctx: SmartContext): Promise<SmartOutput | null> {
  const { store } = ctx;
  if (!store.aiReplies) return null;
  const plan = store.plan as StorePlan;
  if ((await smartUsed(store.id)) >= SHOP_LIMITS[plan].smartPerMonth) return null;
  try {
    const kit = await db.brandKit.findUnique({ where: { tenantId: store.tenantId }, select: { tagline: true, deliveryNote: true } });
    const facts: SmartFacts = {
      shop: store.name.trim() || "the shop",
      tagline: kit?.tagline?.trim() || null,
      delivery: [...(kit?.deliveryNote?.trim() ? [kit.deliveryNote.trim()] : []), ...deliveryFacts(store, ctx.lang)],
      asked: ctx.product ? productFacts(ctx.product, ctx.lang) : null,
      catalog: await catalog(store.id, ctx.product?.id ?? null, ctx.lang),
      orderLink: ctx.waLink,
      ownerDm: store.defaultDm?.trim() || null,
    };
    const turns = ctx.kind === "dm_followup" && ctx.senderId ? await history(store.id, ctx.senderId, ctx.messageId) : [];
    const out = await smartReply({ kind: ctx.kind, lang: ctx.lang, brief: store.aiBrief ?? "", facts, message: ctx.message, history: turns, viaVoice: ctx.viaVoice });
    if (out) await countSmart(store.id);
    return out;
  } catch {
    return null;
  }
}
