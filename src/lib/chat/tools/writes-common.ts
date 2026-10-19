// What the chat's write tools share: the three-language word tables, the live shop lookup, and the bridge to the shop's
// confirmed-tool runner. Nothing here changes anything.

import { cleanAttachments, resolveShop, runShopToolNamed } from "@/app/app/assistant/run-shop-tool";
import { loadConnections } from "@/app/app/data";
import type { ToolName } from "@/lib/assistant/tools";
import { ToolRefusal, type Card, type ChatAttachment, type ToolCtx, type WriteResult } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";

/** One sentence in the person's three languages. */
export type Words = Record<Lang, string>;
export const words = (ckb: string, ar: string, en: string): Words => ({ ckb, ar, en });

/** A sentence with a value in it, in the three languages. */
export type Say<A extends unknown[]> = Record<Lang, (...a: A) => string>;
export const say = <A extends unknown[]>(ckb: (...a: A) => string, ar: (...a: A) => string, en: (...a: A) => string): Say<A> => ({ ckb, ar, en });

/** The files attached in this chat, checked again: only the workspace's own uploads count, whatever the thread says. */
export const attachmentsOf = (ctx: ToolCtx): ChatAttachment[] => cleanAttachments(ctx.attachments, ctx.tenantId, 99);

/** A short plain version of a stored text for a card line: cut on a character boundary, never in the middle of a letter. */
export function clip(text: string, max: number): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

/** Stops a card: the sentence goes back to the model as the tool's result (English, no secret). */
export function refuse(message: string): never {
  throw new ToolRefusal(message);
}

export const NO_SHOP = "Nothing is connected yet. The person connects a Facebook Page or an Instagram account with the Connect button that show_accounts puts in the chat; you cannot do that for them.";
export const productNotFound = (hint: unknown) =>
  `No single product matches "${String(hint ?? "").slice(0, 80)}". Call list_products and pass the product's exact name or its id.`;

/**
 * The shop an action is for and the product it names, from the live data: the same rule the confirmed tool uses when it runs
 * (resolveShop), so a card never shows a shop or a product the run would not pick.
 */
export async function shopFor(ctx: ToolCtx, productHint?: unknown) {
  const conns = await loadConnections(ctx.tenantId);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const shop = await resolveShop(ctx.tenantId, connectedIds, productHint);
  if (!shop.ok) return refuse(shop.why === "noShop" ? NO_SHOP : productNotFound(productHint));
  return { conns, ...shop };
}

/**
 * The exact product a card resolved, as the arguments to store in place of the model's loose name: Confirm then acts on the product
 * the card showed, even if names change before the person presses it. Nothing to pin when no product was named.
 */
export function pinOf(args: { product?: unknown }, shop: { productId: string | null }): Pick<Card, "pin"> {
  return typeof args.product === "string" && args.product.trim() && shop.productId ? { pin: { product: shop.productId } } : {};
}

/**
 * A result sentence that names the shop it acted on, when the workspace has several (with one there is nothing to tell apart). The
 * shop is on its own line, worded as on the card, so a model that reports "done" cannot leave the person guessing which shop it was.
 */
export function inShop(lang: Lang, text: string, shop: { shopName: string; shopCount: number }): string {
  if (shop.shopCount < 2 || !shop.shopName) return text;
  return [text, `${dict(lang).assistant.fields.shop}: ${shop.shopName}`].join("\n");
}

/** The tools whose change belongs to the whole workspace, not to one of its shops: their result names no shop. */
const WORKSPACE_WIDE: readonly ToolName[] = ["set_whatsapp_number"];

/** Runs one of the shop's existing tools through the runner the classic assistant uses: the same actions, checks and limits. */
export async function runShop(ctx: ToolCtx, tool: ToolName, args: object): Promise<WriteResult> {
  const r = await runShopToolNamed({
    tenantId: ctx.tenantId,
    t: dict(ctx.lang),
    tool,
    args: args as Record<string, unknown>,
    attachments: attachmentsOf(ctx),
    review: ctx.review,
    igDeadlineMs: Math.max(15_000, Math.min(30_000, ctx.deadline - Date.now() - 20_000)),
  });
  if (!r.result.ok) return { ok: false, text: r.result.error };
  const done = r.result;
  const text = WORKSPACE_WIDE.includes(tool) ? done.text : inShop(ctx.lang, done.text, r);
  return { ok: true, text, ...(done.media ? { media: done.media } : {}), ...(done.jobId ? { jobId: done.jobId } : {}) };
}

/** The platform as the model reads it in a refusal. */
export const platformName = (p: "FB" | "IG") => (p === "FB" ? "Facebook" : "Instagram");
