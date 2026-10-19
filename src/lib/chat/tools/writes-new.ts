// The write tools that are new in the chat. Each one wraps a server action the app's own screens already use (never a second
// copy of its logic): the card looks at the live state and refuses what cannot work, and the run calls the same action.

import { z } from "zod";

import { replyToCommentAction, sendMessageAction, setCommentHiddenAction } from "@/app/app/actions";
import { saveProductAction } from "@/app/app/automation/actions";
import { loadAccountLists, loadConnections, loadConversations, loadPosts, type Connections } from "@/app/app/data";
import { kuDateTime } from "@/app/app/format";
import { setOrderStatusAction } from "@/app/app/orders/actions";
import { cancelScheduledAction } from "@/app/app/publish/schedule-actions";
import { db } from "@/lib/db";
import { ToolRefusal, defineWrite, type ToolCtx, type WriteResult, type WriteTool } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import { isOwnBlobUrl } from "@/lib/merchant/caption";
import { exponentOf, formatMoney } from "@/lib/shop/money";
import { parsePrice } from "@/lib/shop/forms";
import { clip, inShop, pinOf, platformName, productNotFound, refuse, shopFor } from "./writes-common";
import { newsCardGuard, newsRunGuard } from "./writes-news-common";
import { NW } from "./writes-news-words";
import { whatsappCard, whatsappSend } from "./writes-wa";
import { LABEL, NEW } from "./writes-words";

const platform = z.enum(["FB", "IG"]).describe("FB = Facebook, IG = Instagram");
/** Private messages also go out on WhatsApp (a shop only): comments do not. */
const messagePlatform = z.enum(["FB", "IG", "WA"]).describe("FB = Messenger, IG = Instagram DM, WA = WhatsApp (shops only)");

/** The order statuses of the Order model, in the order the Orders screen lists them. */
const ORDER_STATUSES = ["NEW", "CONFIRMED", "SENT", "DELIVERED", "RETURNED", "CANCELLED"] as const;

/** What the action enforces: a reply is at most 2200 characters on Instagram and 8000 on Facebook. */
const REPLY_LIMIT = { FB: 8000, IG: 2200 } as const;

const SCHEMA = {
  set_order_status: z.object({
    order: z.string().trim().min(1).max(60).describe("The order's id exactly as list_orders or get_order gives it"),
    status: z.enum(ORDER_STATUSES),
  }),
  hide_comment: z.object({
    platform,
    comment: z.string().trim().min(1).max(120).describe("The comment's id exactly as list_comments gives it"),
    hidden: z.boolean().default(true).describe("true = hide it, false = show a hidden comment again"),
  }),
  reply_to_comment: z.object({
    platform,
    comment: z.string().trim().min(1).max(120).describe("The comment's id exactly as list_comments gives it"),
    text: z.string().trim().min(1).max(REPLY_LIMIT.FB).describe("The public reply, as the owner would write it"),
  }),
  send_message: z.object({
    platform: messagePlatform,
    conversation: z.string().trim().min(1).max(200).describe("The conversation's id exactly as list_conversations or get_conversation gives it (with that item's platform)"),
    text: z.string().trim().min(1).max(1000),
  }),
  cancel_scheduled_post: z.object({
    post: z.string().trim().min(1).max(60).describe("The scheduled post's id exactly as list_scheduled_posts gives it"),
  }),
  update_product: z
    .object({
      product: z.string().trim().min(1).max(120).describe("The product's exact name, or its id from list_products"),
      name: z.string().trim().min(1).max(80).optional(),
      // Never empty: a model must not blank a description by accident. Clearing one is done in the Products screen.
      description: z.string().trim().min(1).max(500).optional(),
      price: z.string().trim().min(1).max(12).regex(/^[0-9٠-٩۰-۹,. ]+$/).optional().describe("IQD, digits only"),
      inStock: z.boolean().optional(),
    })
    .refine((o) => o.name !== undefined || o.description !== undefined || o.price !== undefined || o.inStock !== undefined, { message: "nothing to change" }),
};

/** A run that finds the shop changed since the card (the comment is gone, the 24 hours ended) says so instead of failing loudly. */
async function guarded(ctx: ToolCtx, run: () => Promise<WriteResult>): Promise<WriteResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ToolRefusal) return { ok: false, text: NEW.stale[ctx.lang] };
    throw e;
  }
}

/**
 * The four tools below serve the shop AND the news desk. A desk's session must be on the desk the run belongs to, and a frozen desk
 * (trial over, nothing paid) may only read: the same two checks as every other desk tool (see defineNews). A shop has neither.
 */
const deskCard = async (ctx: ToolCtx): Promise<void> => {
  if (ctx.kind === "news") await newsCardGuard(ctx);
};
const deskRun = async (ctx: ToolCtx): Promise<WriteResult | null> => (ctx.kind === "news" ? newsRunGuard(ctx) : null);

const fromAction = (r: { ok: true } | { ok: false; error: string }, okText: string): WriteResult => (r.ok ? { ok: true, text: okText } : { ok: false, text: r.error });

/**
 * One platform's connection only, so a lookup reads that platform's comments or messages and not the other's. The account id is
 * passed on to the action so it acts as the account that was looked at (the newest one, as the Comments and Messages screens do).
 * `accountName` is set only when the shop has several accounts on that platform: it is what tells the person which Page the card is for.
 */
async function onePlatform(ctx: ToolCtx, p: "FB" | "IG") {
  const [conns, lists] = await Promise.all([loadConnections(ctx.tenantId), loadAccountLists(ctx.tenantId).catch(() => null)]);
  const account = p === "FB" ? conns.META_FACEBOOK : conns.META_INSTAGRAM;
  if (!account.connected) return refuse(`${platformName(p)} is not connected. The person connects it with the Connect button that show_accounts puts in the chat; you cannot do that for them.`);
  const off = { connected: false } as const;
  const scoped: Connections = { ...conns, META_FACEBOOK: p === "FB" ? conns.META_FACEBOOK : off, META_INSTAGRAM: p === "IG" ? conns.META_INSTAGRAM : off };
  const all = lists ? (p === "FB" ? lists.META_FACEBOOK : lists.META_INSTAGRAM) : [];
  const named = all.find((a) => a.id === account.accountId)?.name;
  const accountName = all.length > 1 ? clip(account.name ?? named ?? account.accountId ?? "", 60) || undefined : undefined;
  return { scoped, accountId: account.accountId, accountName };
}

/** The platform line of a card: "Facebook", or "Facebook · Page name" when the shop has several Pages and the name says which one. */
const platformLine = (ctx: ToolCtx, p: "FB" | "IG", accountName?: string) => {
  const base = dict(ctx.lang).platform[p];
  return accountName ? `${base} · ${accountName}` : base;
};

/** A top-level comment on one of the latest posts: the same list the Comments screen shows, so an id from list_comments is found. */
async function findComment(ctx: ToolCtx, p: "FB" | "IG", id: string) {
  const { scoped, accountId, accountName } = await onePlatform(ctx, p);
  const { posts } = await loadPosts(ctx.tenantId, scoped);
  for (const post of posts) {
    const comment = post.comments.find((c) => c.id === id);
    if (comment) return { comment, accountId, accountName };
  }
  return refuse(`Comment "${id}" was not found among the comments of the latest ${platformName(p)} posts (or ${platformName(p)} did not answer). Use an id from list_comments.`);
}

/** A conversation the shop may still write to: Meta allows a free message only within 24 hours of the customer's last one. */
async function findConversation(ctx: ToolCtx, p: "FB" | "IG", id: string) {
  const { scoped, accountId, accountName } = await onePlatform(ctx, p);
  const { conversations } = await loadConversations(ctx.tenantId, scoped);
  const conv = conversations.find((c) => c.platform === p && c.id === id);
  if (!conv) return refuse(`Conversation "${id}" was not found among the latest ${platformName(p)} conversations. Use an id from list_conversations.`);
  if (!conv.participantId) return refuse(`This conversation has no recipient the ${ctx.kind === "news" ? "desk" : "shop"} can write to.`);
  if (!conv.withinWindow) {
    return refuse(
      "The 24-hour window is closed: Meta allows a free message only within 24 hours of the customer's last message. " +
        "Tell the person to answer another way (for example WhatsApp) or wait until the customer writes again.",
    );
  }
  return { conv, recipient: conv.participantId, accountId, accountName };
}

/** A product in the shape the product form saves, read live: what is not changed is passed back exactly as it is. */
async function planProduct(ctx: ToolCtx, args: z.output<typeof SCHEMA.update_product>) {
  const shop = await shopFor(ctx, args.product);
  if (!shop.productId) return refuse(productNotFound(args.product));
  const product = await db.product.findFirst({
    where: { id: shop.productId, active: true, store: { tenantId: ctx.tenantId } },
    select: { id: true, name: true, description: true, photos: true, variants: { orderBy: { position: "asc" }, select: { label: true, amountMinor: true, currency: true, inStock: true } } },
  });
  if (!product) return refuse(productNotFound(args.product));
  // Saving a product replaces all its prices and photos, so only a product the chat can write back whole is touched.
  if (product.variants.length !== 1) return refuse("This product has several prices or sizes. Changing it from the chat could lose some of them: tell the person to edit it in the Products screen.");
  if (product.photos.length > 5 || !product.photos.every((u) => isOwnBlobUrl(u, ctx.tenantId))) {
    return refuse("This product has photos the chat cannot keep unchanged. Tell the person to edit it in the Products screen.");
  }
  const variant = product.variants[0];
  if (args.price !== undefined) {
    if (variant.currency !== "IQD") return refuse(`This product is priced in ${variant.currency}, and a price given here is IQD. Tell the person to change it in the Products screen.`);
    if (parsePrice(args.price, "IQD") === null) return refuse("The price must be a positive whole number of IQD, digits only.");
  }
  const exp = exponentOf(variant.currency);
  const input = {
    name: args.name ?? product.name,
    description: args.description ?? product.description ?? "",
    photos: product.photos,
    variants: [{ label: variant.label, price: args.price ?? (variant.amountMinor / 10 ** exp).toFixed(exp), currency: variant.currency, inStock: args.inStock ?? variant.inStock }],
  };
  const changes = {
    name: args.name !== undefined && args.name !== product.name,
    description: args.description !== undefined && args.description !== (product.description ?? ""),
    price: args.price !== undefined && parsePrice(args.price, "IQD") !== variant.amountMinor,
    inStock: args.inStock !== undefined && args.inStock !== variant.inStock,
  };
  if (!Object.values(changes).some(Boolean)) return refuse("Nothing would change: the product already has these values.");
  return { shop, product, variant, input, changes };
}

const setOrderStatus = defineWrite({
  name: "set_order_status",
  description:
    "Change an order's status. order: the order's id exactly as list_orders or get_order gives it. status: NEW, CONFIRMED (the shop accepted it), SENT (handed to delivery), DELIVERED, RETURNED or CANCELLED. " +
    "This only records the status in Gituas; it does not message the buyer or the courier.",
  schema: SCHEMA.set_order_status,
  kinds: ["shop"],
  permission: "engage",
  // The action only updates the order row: nothing is sent to the buyer and nothing else is triggered.
  risk: "low",
  label: (lang) => LABEL.order[lang],
  async card(ctx, args) {
    const order = await db.order.findFirst({
      where: { id: args.order, tenantId: ctx.tenantId },
      select: { customerName: true, productName: true, status: true, amountMinor: true, currency: true },
    });
    if (!order) return refuse(`There is no order with id "${args.order}" in this shop. Use an id from list_orders or get_order.`);
    if (order.status === args.status) return refuse(`The order is already ${order.status}.`);
    const status = dict(ctx.lang).orders.status as Record<string, string>;
    const what = [order.customerName, order.productName, order.amountMinor > 0 ? formatMoney(order.amountMinor, order.currency, ctx.lang) : ""].filter(Boolean).join(" · ");
    return {
      title: NEW.title.setOrderStatus[ctx.lang],
      lines: [
        { label: NEW.field.order[ctx.lang], value: clip(what, 140) },
        { label: NEW.field.status[ctx.lang], value: NEW.was[ctx.lang](status[args.status] ?? args.status, status[order.status] ?? order.status) },
      ],
    };
  },
  async execute(ctx, args) {
    const status = dict(ctx.lang).orders.status as Record<string, string>;
    const r = await setOrderStatusAction(args.order, args.status);
    return fromAction(r, NEW.done.orderStatus[ctx.lang](status[args.status] ?? args.status));
  },
});

const hideComment = defineWrite({
  name: "hide_comment",
  description:
    "Hide a comment on one of the account's posts (the shop's or the news desk's), or show a hidden one again (hidden: false). platform: FB or IG. comment: the comment's id exactly as list_comments gives it. " +
    "Hiding is reversible and does not delete the comment.",
  schema: SCHEMA.hide_comment,
  kinds: ["shop", "news"],
  permission: "engage",
  risk: "low",
  label: (lang) => LABEL.comment[lang],
  async card(ctx, args) {
    await deskCard(ctx);
    const { comment, accountName } = await findComment(ctx, args.platform, args.comment);
    if (comment.hidden === args.hidden) return refuse(args.hidden ? "That comment is already hidden." : "That comment is not hidden.");
    return {
      title: (args.hidden ? NEW.title.hideComment : NEW.title.showComment)[ctx.lang],
      lines: [
        { label: NEW.field.platform[ctx.lang], value: platformLine(ctx, args.platform, accountName) },
        { label: NEW.field.comment[ctx.lang], value: clip(`${comment.author}: ${comment.text}`, 220) },
      ],
    };
  },
  execute: async (ctx, args) =>
    (await deskRun(ctx)) ??
    guarded(ctx, async () => {
      const { accountId } = await onePlatform(ctx, args.platform);
      const r = await setCommentHiddenAction(args.platform, args.comment, args.hidden, accountId);
      return fromAction(r, (args.hidden ? NEW.done.hidden : NEW.done.shown)[ctx.lang]);
    }),
});

const replyToComment = defineWrite({
  name: "reply_to_comment",
  description:
    "Publicly reply to a comment as the shop or the news desk. platform: FB or IG. comment: the comment's id exactly as list_comments gives it. " +
    "text: the reply, in the language of the comment, as the owner would write it (up to 2200 characters on Instagram and 8000 on Facebook). Everyone can read it. " +
    "Any run of ten or more digits is taken for a phone number and removed from the text unless the person typed it themselves: write a big amount with a word (1.5 billion IQD), not in full digits.",
  schema: SCHEMA.reply_to_comment,
  kinds: ["shop", "news"],
  permission: "engage",
  risk: "outbound",
  textFields: ["text"],
  label: (lang) => LABEL.comment[lang],
  async card(ctx, args) {
    await deskCard(ctx);
    if (Array.from(args.text).length > REPLY_LIMIT[args.platform]) return refuse(`The reply is longer than the ${REPLY_LIMIT[args.platform]} characters ${platformName(args.platform)} allows.`);
    const { comment, accountName } = await findComment(ctx, args.platform, args.comment);
    if (comment.fromUs) return refuse(ctx.kind === "news" ? "That comment was written by the desk's own page, not by a visitor." : "That comment was written by the shop's own account, not by a customer.");
    const lines = [
      { label: NEW.field.platform[ctx.lang], value: platformLine(ctx, args.platform, accountName) },
      { label: NEW.field.comment[ctx.lang], value: clip(`${comment.author}: ${comment.text}`, 220) },
      { label: NEW.field.reply[ctx.lang], value: args.text },
    ];
    // The person should know before sending a second answer.
    if (comment.replies.some((r) => r.fromUs)) lines.push({ label: NEW.field.note[ctx.lang], value: (ctx.kind === "news" ? NW.alreadyReplied : NEW.alreadyAnswered)[ctx.lang] });
    return { title: NEW.title.replyToComment[ctx.lang], lines };
  },
  execute: async (ctx, args) =>
    (await deskRun(ctx)) ??
    guarded(ctx, async () => {
      const { accountId } = await onePlatform(ctx, args.platform);
      const r = await replyToCommentAction(args.platform, args.comment, args.text, accountId);
      return fromAction(r, NEW.done.replied[ctx.lang]);
    }),
});

const sendMessage = defineWrite({
  name: "send_message",
  description:
    "Send a private message in an existing conversation, as the shop or the news desk. platform: FB (Messenger), IG (Instagram DM) or WA (WhatsApp, shops only). conversation: the conversation's id exactly as list_conversations or get_conversation gives it, with that item's platform. " +
    "text: up to 1000 characters. Any run of ten or more digits is taken for a phone number and removed from the text unless the person typed it themselves: write a big amount with a word (1.5 billion IQD). " +
    "Meta and WhatsApp allow this only within 24 hours of the customer's last message; outside that window the tool is refused. On WhatsApp this is free text only: message templates are not part of the chat, " +
    "a customer who wrote STOP is never written to, and once it is sent the shop's automatic replies stay out of that chat for good (nothing in the app switches them back on).",
  schema: SCHEMA.send_message,
  kinds: ["shop", "news"],
  permission: "engage",
  risk: "outbound",
  textFields: ["text"],
  label: (lang) => LABEL.conversation[lang],
  async card(ctx, args) {
    await deskCard(ctx);
    if (args.platform === "WA") return whatsappCard(ctx, args);
    const { conv, accountName } = await findConversation(ctx, args.platform, args.conversation);
    const last = [...conv.messages].reverse().find((m) => !m.fromUs);
    const lines = [
      { label: NEW.field.platform[ctx.lang], value: platformLine(ctx, args.platform, accountName) },
      { label: NEW.field.to[ctx.lang], value: conv.participantName || dict(ctx.lang).platform[args.platform] },
    ];
    if (last?.text) lines.push({ label: NEW.field.lastMessage[ctx.lang], value: clip(last.text, 200) });
    lines.push({ label: NEW.field.message[ctx.lang], value: args.text });
    return { title: NEW.title.sendMessage[ctx.lang], lines };
  },
  // The window is checked again: a card can wait for its Confirm.
  execute: async (ctx, args) =>
    (await deskRun(ctx)) ??
    guarded(ctx, async () => {
      if (args.platform === "WA") return whatsappSend(ctx, args);
      const { recipient, accountId } = await findConversation(ctx, args.platform, args.conversation);
      const r = await sendMessageAction(args.platform, recipient, args.text, accountId);
      return fromAction(r, NEW.done.sent[ctx.lang]);
    }),
});

const cancelScheduledPost = defineWrite({
  name: "cancel_scheduled_post",
  description:
    "Cancel a post that is scheduled but has not gone out yet. post: the scheduled post's id exactly as list_scheduled_posts gives it. Only pending posts can be cancelled.",
  schema: SCHEMA.cancel_scheduled_post,
  kinds: ["shop", "news"],
  permission: "publish",
  risk: "destructive",
  label: (lang) => LABEL.scheduled[lang],
  async card(ctx, args) {
    await deskCard(ctx);
    const row = await db.scheduledPost.findFirst({ where: { id: args.post, tenantId: ctx.tenantId, status: "PENDING" }, select: { runAt: true, input: true } });
    if (!row) return refuse(`There is no pending scheduled post with id "${args.post}" (it may have gone out, failed or been cancelled already). Use an id from list_scheduled_posts.`);
    const t = dict(ctx.lang);
    const input = (row.input ?? {}) as { caption?: unknown; targets?: unknown };
    const targets = (Array.isArray(input.targets) ? input.targets : []).map((x) => (t.platform as Record<string, string>)[String(x)] ?? String(x)).join(" + ");
    const lines = [{ label: t.assistant.fields.when, value: kuDateTime(row.runAt.toISOString(), t) }];
    if (targets) lines.push({ label: t.assistant.fields.targets, value: targets });
    if (typeof input.caption === "string" && input.caption) lines.push({ label: t.assistant.fields.caption, value: clip(input.caption, 140) });
    return { title: NEW.title.cancelScheduled[ctx.lang], lines };
  },
  async execute(ctx, args) {
    const stopped = await deskRun(ctx);
    if (stopped) return stopped;
    return fromAction(await cancelScheduledAction(args.post), NEW.done.cancelled[ctx.lang]);
  },
});

const updateProduct = defineWrite({
  name: "update_product",
  description:
    "Change a product that already exists: name, description, price (IQD, digits only) and/or inStock. Fields you leave out stay exactly as they are. product: the exact name, or the id from list_products. " +
    "It works only for a product with a single price and no sizes, and it cannot clear a description or change photos; for those the person uses the Products screen.",
  schema: SCHEMA.update_product,
  kinds: ["shop"],
  permission: "configure",
  risk: "public",
  textFields: ["name", "description"],
  label: (lang) => LABEL.product[lang],
  async card(ctx, args) {
    const { shop, product, variant, changes } = await planProduct(ctx, args);
    const t = dict(ctx.lang);
    const f = t.assistant.fields;
    const lines = [{ label: f.product, value: product.name }];
    if (changes.name) lines.push({ label: f.name, value: NEW.was[ctx.lang](args.name!, product.name) });
    if (changes.description) lines.push({ label: f.description, value: NEW.was[ctx.lang](clip(args.description!, 140), clip(product.description ?? "", 60) || "—") });
    if (changes.price) lines.push({ label: f.price, value: NEW.was[ctx.lang](formatMoney(parsePrice(args.price!, "IQD")!, "IQD", ctx.lang), formatMoney(variant.amountMinor, variant.currency, ctx.lang)) });
    if (changes.inStock) lines.push({ label: f.inStock, value: NEW.was[ctx.lang](args.inStock ? f.yes : f.no, variant.inStock ? f.yes : f.no) });
    if (shop.shopName) lines.push({ label: f.shop, value: shop.shopName });
    // Confirm changes the product the card showed, even if a name is changed before the person presses it.
    return { title: NEW.title.updateProduct[ctx.lang], lines, ...pinOf(args, shop) };
  },
  // Read again here: the product is merged with what it is now, not with what it was when the card was made.
  execute: (ctx, args) =>
    guarded(ctx, async () => {
      const { shop, product, input } = await planProduct(ctx, args);
      const r = await saveProductAction(shop.store.id, product.id, input);
      return fromAction(r, inShop(ctx.lang, NEW.done.productUpdated[ctx.lang], shop));
    }),
});

export const NEW_WRITE_TOOLS: WriteTool[] = [setOrderStatus, hideComment, replyToComment, sendMessage, cancelScheduledPost, updateProduct];
