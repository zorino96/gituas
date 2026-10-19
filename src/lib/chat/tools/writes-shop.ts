// The eleven write tools the classic assistant already had, with the same names and arguments (their schemas are
// SCHEMAS of src/lib/assistant/tools.ts). The card says what will happen and refuses what cannot work; the run goes
// through runShopTool, so every check of the old confirm path (connected accounts, several Pages refused unless the person chose one
// in the chat, JPEG for Instagram, product matching, plan limits, the image and video switches) is the one and only copy.

import { postProblem, type PostProblem } from "@/app/app/assistant/run-shop-tool";
import type { Connections } from "@/app/app/data";
import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import { plainName } from "@/lib/assistant/ask";
import { proposalLines, SCHEMAS, type ToolName } from "@/lib/assistant/tools";
import { defineWrite, type Card, type CardLine, type ToolCtx, type WriteTool } from "@/lib/chat/types";
import { dict } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n/lang";
import { captionProblems, type Target } from "@/lib/merchant/caption";
import { normalizePhone } from "@/lib/merchant/phone";
import { baghdadLocalToUtc, scheduleProblem } from "@/lib/merchant/schedule";
import { scopedAccount } from "@/lib/oauth/account-scope";
import { parsePrice } from "@/lib/shop/forms";
import { instagramPhrase, pagePhrase } from "./reads-accounts";
import { attachmentsOf, clip, pinOf, platformName, refuse, runShop, shopFor } from "./writes-common";
import { CARD, LABEL, NEW } from "./writes-words";

/** The texts of set_shop_options that an empty string clears. The card has to say so: an empty value would otherwise show no line at all. */
const CLEARABLE = ["defaultDm", "aiBrief", "deliveryTime", "deliveryFee"] as const;

/**
 * The card of one of the shop's tools: the app's own title and labels, the exact values, and the shop it is for. A product the model
 * named loosely (a part of the name, or its id) is shown by the name it resolved to, so the person sees what will really be used,
 * and is pinned to the id it resolved to, so Confirm acts on that same product. A text that is cleared is shown as cleared.
 */
function cardOf(ctx: ToolCtx, tool: ToolName, args: object, shop: { shopName: string; productId?: string | null; productName?: string | null; conns?: Connections }): Card {
  const t = dict(ctx.lang);
  const files = Object.fromEntries(attachmentsOf(ctx).map((x) => [x.id, plainName(x.name) || x.kind]));
  const shown: Record<string, unknown> = shop.productName ? { ...args, product: shop.productName } : { ...args };
  if (tool === "set_shop_options") for (const k of CLEARABLE) if (shown[k] === "") shown[k] = CARD.cleared[ctx.lang];
  const lines = proposalLines({ tool, args: shown }, t.assistant.fields, { files, shop: shop.shopName });
  // A post names the Page / Instagram account it goes to, right after "where" (the first line), when the person chose it in the chat.
  if (tool === "post_now" || tool === "schedule_post") lines.splice(1, 0, ...chosenAccountLine(ctx.lang, (args as { targets?: string[] }).targets ?? [], shop.conns));
  return {
    title: (t.assistant.tools as Record<string, string>)[tool] ?? tool,
    lines,
    ...pinOf(args as { product?: unknown }, { productId: shop.productId ?? null }),
  };
}

/**
 * "To: the Facebook Page «X» + the Instagram account @y": the accounts a post will go to, from the connections as the chat sees them
 * (narrowed to the chosen account). Only a platform the person chose an account for gets a name; with one account there is nothing to
 * tell apart, and a platform with several and no choice never reaches a card (postProblem).
 */
function chosenAccountLine(lang: Lang, targets: readonly string[], conns?: Connections): CardLine[] {
  if (!conns) return [];
  const parts: string[] = [];
  const fb = scopedAccount("META_FACEBOOK");
  if (fb && targets.includes("FB") && conns.META_FACEBOOK.connected) parts.push(pagePhrase(lang, clip(conns.META_FACEBOOK.name ?? fb, 60)));
  const ig = scopedAccount("META_INSTAGRAM");
  if (ig && targets.includes("IG") && conns.META_INSTAGRAM.connected) parts.push(instagramPhrase(lang, clip(conns.META_INSTAGRAM.name ?? ig, 60)));
  return parts.length ? [{ label: NEW.field.to[lang], value: parts.join(" + ") }] : [];
}

/** Every id must be a file attached in this chat (and a picture where a picture is needed). The model must never invent one. */
function needFiles(ctx: ToolCtx, ids: readonly string[], what: string, kind: "image" | "any" = "any") {
  const have = attachmentsOf(ctx);
  for (const id of ids) {
    const f = have.find((x) => x.id === id);
    if (!f) return refuse(`"${id}" is not one of the files attached in this chat. Use an id from the attachment list; never invent one.`);
    if (kind === "image" && f.kind !== "image") return refuse(`"${id}" is a video, but ${what} needs a picture.`);
  }
}

const POST_PROBLEM = (p: PostProblem): string => {
  switch (p.why) {
    case "notConnected":
      return `${p.platform} is not connected. The person connects it with the Connect button that show_accounts puts in the chat; you cannot do that for them.`;
    case "severalAccounts":
      return "There are several Facebook Pages or Instagram accounts connected, and the person has not chosen which one the chat posts as, so it would have to guess. Call show_accounts: it puts the Choose button in the chat. Say that a choice takes effect from their next message, then post once they have chosen.";
    case "badAction":
      return "The media id is not one of the files attached in this chat. Use an id from the attachment list.";
    case "needJpeg":
      return "Instagram takes only JPEG pictures and the attached picture is not a JPEG. Ask the person for a JPEG file.";
  }
};

/** What post_now and schedule_post share: the post must be whole, fit the platforms, and be possible with the connected accounts. */
async function checkPost(ctx: ToolCtx, args: { caption: string; targets: ("FB" | "IG")[]; media?: string; product?: string; when?: string }) {
  const targets = [...new Set(args.targets)];
  if (!args.caption && !args.media) refuse("A post needs a caption or an attached picture or video.");
  if (targets.includes("IG") && !args.media) refuse("Instagram posts need an attached picture or video.");
  needFiles(ctx, args.media ? [args.media] : [], "the post");
  const tooLong = captionProblems(args.caption, targets as Target[])[0];
  if (tooLong) refuse(tooLong.problem === "hashtags" ? "Instagram allows at most 30 hashtags in one caption." : `The caption is too long for ${platformName(tooLong.target as "FB" | "IG")}.`);
  if (args.when !== undefined) {
    const problem = scheduleProblem(targets, baghdadLocalToUtc(args.when), new Date(), dict("en").actions.publish);
    if (problem) refuse(`${problem} (The time is Baghdad time, between 10 minutes and 60 days from now.)`);
  }
  const shop = await shopFor(ctx, args.product);
  const problem = await postProblem(ctx.tenantId, args, attachmentsOf(ctx), shop.conns);
  if (problem) refuse(POST_PROBLEM(problem));
  return shop;
}

const MODES = "mode is OFF, DRAFT (prepares it for the owner to review) or PUBLISH (does it by itself, publicly).";

export const SHOP_WRITE_TOOLS: WriteTool[] = [
  defineWrite({
    name: "make_picture",
    description:
      "Make an AI picture for a post or an ad. idea: what the picture should show, in the owner's words. shape: \"square\" (default) or \"portrait\" (4:5). " +
      "references: ids of attached pictures to follow, for example [\"a1\"] (only ids from the attachment list). product: the exact name, or the id from list_products, of the product it shows, if any. " +
      "It uses one of the shop's AI pictures and takes up to a minute; the finished picture is added to the chat's attachments so it can be posted next.",
    schema: SCHEMAS.make_picture,
    kinds: ["shop"],
    permission: "publish",
    risk: "money",
    long: true,
    textFields: ["idea"],
    label: (lang) => LABEL.make_picture[lang],
    async card(ctx, args) {
      if (!imageEnabled()) refuse("Making AI pictures is switched off on this server right now.");
      needFiles(ctx, args.references, "a reference", "image");
      const shop = await shopFor(ctx, args.product);
      return cardOf(ctx, "make_picture", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "make_picture", args),
  }),
  defineWrite({
    name: "make_video",
    description:
      "Start an AI video ad for the shop. idea: what the video is about, in the owner's words. product: the exact name, or the id from list_products, of the product it features, if any. " +
      "It is made in the background and takes a few minutes; this tool does not post it.",
    schema: SCHEMAS.make_video,
    kinds: ["shop"],
    permission: "publish",
    risk: "money",
    textFields: ["idea"],
    label: (lang) => LABEL.make_video[lang],
    async card(ctx, args) {
      if (!adVideoEnabled()) refuse("Making AI videos is switched off on this server right now.");
      const shop = await shopFor(ctx, args.product);
      return cardOf(ctx, "make_video", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "make_video", args),
  }),
  defineWrite({
    name: "post_now",
    description:
      "Publish a post right now to Facebook and/or Instagram. caption: the post text (it may be empty only when a file is attached). targets: [\"FB\"], [\"IG\"] or both; Instagram needs a picture (JPEG) or a video. " +
      "media: the id of one attached file, for example \"a1\". product: the exact name, or the id from list_products, of the product the post is about. " +
      "Refused when a platform is not connected, or when there are several Pages or Instagram accounts and the person has not chosen one in the chat (show_accounts lets them choose). It posts as the account they chose, and the card names it.",
    schema: SCHEMAS.post_now,
    kinds: ["shop"],
    permission: "publish",
    risk: "public",
    textFields: ["caption"],
    label: (lang) => LABEL.post_now[lang],
    async card(ctx, args) {
      return cardOf(ctx, "post_now", args, await checkPost(ctx, args));
    },
    execute: (ctx, args) => runShop(ctx, "post_now", args),
  }),
  defineWrite({
    name: "schedule_post",
    description:
      "Publish a post to Facebook and/or Instagram at a later time. Same arguments as post_now, plus when: Baghdad wall-clock time as YYYY-MM-DDTHH:mm, from 10 minutes to 60 days from now. " +
      "Work out the date from the current Baghdad time in the account snapshot; never guess it.",
    schema: SCHEMAS.schedule_post,
    kinds: ["shop"],
    permission: "publish",
    risk: "public",
    textFields: ["caption"],
    label: (lang) => LABEL.schedule_post[lang],
    async card(ctx, args) {
      return cardOf(ctx, "schedule_post", args, await checkPost(ctx, args));
    },
    execute: (ctx, args) => runShop(ctx, "schedule_post", args),
  }),
  defineWrite({
    name: "set_auto_replies",
    description: "Switch the shop's automatic replies to comments and messages on (on: true) or off (on: false).",
    schema: SCHEMAS.set_auto_replies,
    kinds: ["shop"],
    permission: "configure",
    // Switching them on makes the shop answer buyers by itself from then on, unwatched.
    risk: "standing",
    riskFor: (args) => (args.on ? "standing" : "low"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_auto_replies", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_auto_replies", args),
  }),
  defineWrite({
    name: "set_autopilot",
    description: `Set the automatic posts. ${MODES} perDay: 1 to 3 posts a day (optional).`,
    schema: SCHEMAS.set_autopilot,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    riskFor: (args) => (args.mode === "PUBLISH" ? "standing" : "low"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_autopilot", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_autopilot", args),
  }),
  defineWrite({
    name: "set_daily_video",
    description:
      `Set the daily AI video. ${MODES} hour: 0 to 23, Baghdad time, after which the day's video is made; leave it out to keep the hour already chosen.`,
    schema: SCHEMAS.set_daily_video,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    // DRAFT does not publish, but it makes (and pays for) a video every day without anyone watching: only OFF is small and safe.
    riskFor: (args) => (args.mode === "OFF" ? "low" : "standing"),
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      if (!adVideoEnabled()) refuse("AI videos are switched off on this server right now.");
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_daily_video", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_daily_video", args),
  }),
  defineWrite({
    name: "set_shop_options",
    description:
      "Change the shop's own switches and texts; only the fields you give change. likeComments, autoHideSpam, aiReplies: true or false (aiReplies lets the AI write the replies to buyers). " +
      "expiryDays: 1 to 365, how many days a post keeps getting automatic replies. defaultDm: the default private message sent to a commenter. deliveryFee: IQD, digits only. " +
      "deliveryTime: free text such as \"1-2 days\". aiBrief: what the AI should know about the shop and how to talk to buyers. " +
      "An empty string (\"\") clears that text or fee, and the card shows it as cleared; send it only when the owner asked to remove it, and leave a field out to keep it as it is.",
    schema: SCHEMAS.set_shop_options,
    kinds: ["shop"],
    permission: "configure",
    risk: "standing",
    textFields: ["defaultDm", "aiBrief", "deliveryTime"],
    riskFor: (args) => {
      // Switching on what answers, hides or likes by itself acts later, unwatched: it always needs a card.
      if (args.aiReplies === true || args.autoHideSpam === true || args.likeComments === true) return "standing";
      // The texts and the delivery terms are what buyers read, whether they are set or cleared.
      if (args.defaultDm !== undefined || args.aiBrief !== undefined || args.deliveryFee !== undefined || args.deliveryTime !== undefined) return "public";
      return "low";
    },
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_shop_options", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_shop_options", args),
  }),
  defineWrite({
    name: "add_product",
    description:
      "Add a new product with one price. name (up to 80 characters), description (optional), price: IQD, digits only, inStock (default true), photos: ids of attached pictures, for example [\"a1\"]. " +
      "To change a product that already exists use update_product instead.",
    schema: SCHEMAS.add_product,
    kinds: ["shop"],
    permission: "configure",
    risk: "public",
    textFields: ["name", "description"],
    label: (lang) => LABEL.product[lang],
    async card(ctx, args) {
      needFiles(ctx, args.photos, "a product photo", "image");
      if (parsePrice(args.price, "IQD") === null) refuse("The price must be a positive whole number of IQD, digits only.");
      const shop = await shopFor(ctx);
      return cardOf(ctx, "add_product", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "add_product", args),
  }),
  defineWrite({
    name: "archive_product",
    description:
      "Remove a product from the shop. It leaves the Products screen and the owner cannot bring it back from the app; it can only be added again as a new product, with its price and photos. " +
      "product: the exact product name, or its id from list_products.",
    schema: SCHEMAS.archive_product,
    kinds: ["shop"],
    permission: "configure",
    // Nothing in the app restores it, and the Products screen itself asks "Delete this product?": the chat always asks too.
    risk: "destructive",
    label: (lang) => LABEL.product[lang],
    async card(ctx, args) {
      const shop = await shopFor(ctx, args.product);
      const card = cardOf(ctx, "archive_product", args, shop);
      return { ...card, lines: [...card.lines, { label: NEW.field.note[ctx.lang], value: CARD.archiveNote[ctx.lang] }] };
    },
    execute: (ctx, args) => runShop(ctx, "archive_product", args),
  }),
  defineWrite({
    name: "set_whatsapp_number",
    description: "Save the shop's WhatsApp number, used in the order links, for example \"07701234567\" or \"+9647701234567\".",
    schema: SCHEMAS.set_whatsapp_number,
    kinds: ["shop"],
    permission: "configure",
    // Buyers are sent to this number: a wrong one sends them to a stranger.
    risk: "standing",
    label: (lang) => LABEL.setting[lang],
    async card(ctx, args) {
      if (!normalizePhone(args.number).ok) refuse("That is not a valid phone number. An Iraqi mobile such as 0770 123 4567, or an international number starting with + or 00.");
      const shop = await shopFor(ctx);
      return cardOf(ctx, "set_whatsapp_number", args, shop);
    },
    execute: (ctx, args) => runShop(ctx, "set_whatsapp_number", args),
  }),
];
