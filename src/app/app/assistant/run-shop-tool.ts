// The shop's confirmed tools, run for real. This is the part of "the owner pressed Confirm" that does the work, kept in a plain
// module (NOT "use server": the exports of a server-action file become public endpoints, and these must only be called from
// code that already checked the session, the role and that the card was confirmed).
//
// Two callers share it: runToolAction (the classic assistant screen) and the chat's write tools (src/lib/chat/tools/writes.ts).
// Each tool goes through the same server action the app's own screens use, with that action's own checks and limits.

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import type { ToolName } from "@/lib/assistant/tools";
import type { ChatAttachment } from "@/lib/chat/types";
import { db } from "@/lib/db";
import type { Dict } from "@/lib/i18n";
import { isJpegPath, isOwnBlobUrl } from "@/lib/merchant/caption";
import type { PublishInput } from "@/lib/merchant/publish-core";
import { scopedAccount } from "@/lib/oauth/account-scope";
import { accountsPhraseOf } from "@/lib/shop/brand-name";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { publishAction, saveWhatsAppAction } from "../actions";
import { archiveProductAction, saveProductAction, saveStoreSettingsAction } from "../automation/actions";
import { generateAiImageAction } from "../publish/ai-image-action";
import { schedulePublishAction } from "../publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "../video/actions";
import { loadAccountLists, loadConnections, type Connections } from "../data";

export type ToolResult =
  | {
      ok: true;
      text: string;
      /** A picture made: the screen keeps it as an attachment, ready for "post it". */
      media?: { url: string; pathname: string; kind: "image" | "video"; name: string };
      /** A video being made: the screen asks after it. */
      jobId?: string;
    }
  | { ok: false; error: string };

const ID = /^a\d{1,2}$/;

/** Only the workspace's own uploads count as attachments. The classic screen sends at most ten; a chat thread can hold more (a..a99). */
export function cleanAttachments(raw: unknown, tenantId: string, max = 10): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const x of raw.slice(0, max)) {
    const a = x as Partial<ChatAttachment> | null;
    if (!a || typeof a.id !== "string" || !ID.test(a.id) || typeof a.url !== "string" || typeof a.pathname !== "string") continue;
    if (a.kind !== "image" && a.kind !== "video") continue;
    if (!isOwnBlobUrl(a.url, tenantId) || !a.pathname.startsWith(`merchant/${tenantId}/`) || a.pathname.includes("..")) continue;
    out.push({ id: a.id, url: a.url, pathname: a.pathname, kind: a.kind, name: String(a.name ?? "").slice(0, 80) });
  }
  return out;
}

/**
 * The shop an action is for, and the product it names: the product's shop when a product is named (by its id as the product list
 * gives it, its exact name, or a name that only one product contains), else the shop of the connected account, else the oldest.
 * Used both when a card is made (so it can show the shop) and when it runs.
 *
 * A product is looked up in the database by what was named, never searched among a first batch of rows: a shop may hold any number
 * of products, and an id from list_products must work for every one of them. `shopCount` is how many shops the workspace has (up to
 * 15), so a result can name the shop it acted on when there are several.
 */
export async function resolveShop(tenantId: string, connectedIds: string[], productHint: unknown) {
  const hint = typeof productHint === "string" ? productHint.trim() : "";
  const [stores, found] = await Promise.all([
    db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: 15, select: { id: true, name: true, igUsername: true, fbPageId: true, igUserId: true, videoLang: true } }),
    hint ? findProduct(tenantId, hint) : Promise.resolve(null),
  ]);
  let store = stores.find((s) => (!!s.fbPageId && connectedIds.includes(s.fbPageId)) || (!!s.igUserId && connectedIds.includes(s.igUserId))) ?? stores[0];
  if (!store) return { ok: false as const, why: "noShop" as const };
  let productId: string | null = null;
  let productName: string | null = null;
  if (hint) {
    if (!found) return { ok: false as const, why: "productNotFound" as const };
    productId = found.id;
    productName = found.name;
    store = stores.find((s) => s.id === found.storeId) ?? store;
  }
  // The card and the result say which Page and Instagram account the change is for, by the names they have now (the stored name of a store
  // is the account's name from when it was made). With several shops one that has no account is still named, by its place in the list.
  const named = await accountsPhraseOf({ tenantId, name: store.name, igUsername: store.igUsername, fbPageId: store.fbPageId, igUserId: store.igUserId });
  const shopName = named || (stores.length > 1 ? `#${stores.indexOf(store) + 1}` : "");
  return { ok: true as const, store, productId, productName, shopName, shopCount: stores.length };
}

type FoundProduct = { id: string; name: string; storeId: string };
const PRODUCT_PICK = { id: true, name: true, storeId: true } as const;

/**
 * The one product of this workspace that a hint names: by id first, then by exact name, then by a name that only one product
 * contains. More than one candidate at a step, or none at all, is no product (null). The database does the narrowing; the checks
 * after it are the same rule in plain code, so a result can never be looser than the rule.
 */
async function findProduct(tenantId: string, hint: string): Promise<FoundProduct | null> {
  const scope = { active: true, store: { tenantId } };
  const want = hint.toLowerCase();
  const [byKey, partial] = await Promise.all([
    db.product.findMany({ where: { ...scope, OR: [{ id: hint }, { name: { equals: hint, mode: "insensitive" } }] }, select: PRODUCT_PICK, take: 5 }),
    db.product.findMany({ where: { ...scope, name: { contains: hint, mode: "insensitive" } }, select: PRODUCT_PICK, take: 3 }),
  ]);
  // An id from the product list names exactly one product; a name may be shared, so it is matched as before.
  const byId = byKey.filter((p) => p.id === hint);
  const exact = byKey.filter((p) => p.name.trim().toLowerCase() === want);
  const loose = byId.length ? byId : exact.length ? exact : partial.filter((p) => p.name.toLowerCase().includes(want));
  return loose.length === 1 ? loose[0] : null;
}

/** Why a post cannot go out, as a code that is also the key of the wording in `t.assistant.errors`. The chat's card uses the same check. */
export type PostProblem = { why: "notConnected"; platform: "Facebook" | "Instagram" } | { why: "severalAccounts" | "badAction" | "needJpeg" };

/** The connection provider behind each post target. */
const POST_PROVIDER = { FB: "META_FACEBOOK", IG: "META_INSTAGRAM" } as const;

/**
 * The accounts the chat posts as, in the shape publishForWorkspace takes (account ids per platform): the ones the person chose in the
 * chat for the platforms of this post. Nothing when the person chose none; the post then goes to the platform's only account, or is
 * refused when it has several (postProblem).
 */
export function chosenPostAccounts(targets: readonly ("FB" | "IG")[]): NonNullable<PublishInput["accounts"]> | undefined {
  const out: NonNullable<PublishInput["accounts"]> = {};
  for (const tg of targets) {
    const id = scopedAccount(POST_PROVIDER[tg]);
    if (id) out[tg] = [id];
  }
  return Object.keys(out).length ? out : undefined;
}

export async function postProblem(tenantId: string, args: Record<string, unknown>, atts: ChatAttachment[], conns: Connections): Promise<PostProblem | null> {
  const targets = args.targets as ("FB" | "IG")[];
  const connected = { FB: !!conns.META_FACEBOOK.connected, IG: !!conns.META_INSTAGRAM.connected };
  for (const tg of targets) if (!connected[tg]) return { why: "notConnected", platform: tg === "FB" ? "Facebook" : "Instagram" };
  // With several Pages (or Instagram accounts) the person chooses which; nothing is guessed here. In the chat the choice is the Accounts
  // sheet: a platform whose account was chosen there is not "several" any more, and the post is sent to that account (chosenPostAccounts).
  const lists = await loadAccountLists(tenantId);
  const unchosen = (tg: "FB" | "IG") => targets.includes(tg) && lists[POST_PROVIDER[tg]].length > 1 && !scopedAccount(POST_PROVIDER[tg]);
  if (unchosen("FB") || unchosen("IG")) return { why: "severalAccounts" };
  const m = args.media ? atts.find((x) => x.id === args.media) : undefined;
  if (args.media && !m) return { why: "badAction" };
  if (m && m.kind === "image" && targets.includes("IG") && !isJpegPath(m.pathname)) return { why: "needJpeg" };
  return null;
}

export interface ShopToolInput {
  tenantId: string;
  /** The person's language: the words of the result. */
  t: Dict;
  /** A shop tool of src/lib/assistant/tools.ts, with its arguments already parsed by that tool's schema. */
  tool: ToolName;
  args: Record<string, unknown>;
  /** Already cleaned (cleanAttachments, or the chat's own list): the workspace's uploads only. */
  attachments: ChatAttachment[];
  /** "Let Gituas review my idea first": the same switch as in Publish and in the Video section. */
  review: boolean;
  /** How long an Instagram post may be waited for (ms): the chat gives the confirm request's remaining time, the classic screen none. */
  igDeadlineMs?: number;
}

/** Runs one confirmed shop tool. The caller has checked the session, the role, the card's one-time claim and the daily caps. */
export async function runShopTool(input: ShopToolInput): Promise<ToolResult> {
  return (await runShopToolNamed(input)).result;
}

/** What a run did and the shop it acted on, so a caller (the chat) can name that shop in its answer when the workspace has several. */
export interface ShopToolRun {
  result: ToolResult;
  shopName: string;
  shopCount: number;
}

/** runShopTool, with the shop it acted on. The classic assistant screen only needs the result; the chat names the shop. */
export async function runShopToolNamed(input: ShopToolInput): Promise<ShopToolRun> {
  const { tenantId, t, args } = input;

  // The shop the action is for (the same rule as the card used to show it).
  const conns = await loadConnections(tenantId);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const shop = await resolveShop(tenantId, connectedIds, args.product);
  if (!shop.ok) return { result: { ok: false, error: t.assistant.errors[shop.why] }, shopName: "", shopCount: 0 };
  return { result: await perform(input, conns, shop), shopName: shop.shopName, shopCount: shop.shopCount };
}

async function perform(input: ShopToolInput, conns: Connections, shop: Extract<Awaited<ReturnType<typeof resolveShop>>, { ok: true }>): Promise<ToolResult> {
  const { tenantId, t, tool, args, attachments: atts, review } = input;
  const a = t.assistant;
  const { store, productId } = shop;
  const att = (id: unknown) => atts.find((x) => x.id === id);
  const tier = (await limitsOf(tenantId)).videos.PRO > 0 ? "PRO" : "LITE";

  switch (tool) {
    case "make_picture": {
      if (!imageEnabled()) return { ok: false, error: a.errors.featureOff };
      const refUrls = ((args.references as string[]) ?? []).map((id) => att(id)).filter((x) => x?.kind === "image").map((x) => x!.url);
      const r = await generateAiImageAction({ idea: String(args.idea), productId, refUrls, shape: args.shape === "portrait" ? "portrait" : "square", review });
      if (!r.ok) return { ok: false, error: r.error };
      const how = r.reviewed ? t.publish.ai.reviewedNote(r.summary) : t.publish.ai.sentAsWritten;
      return { ok: true, text: `${a.done.picture}\n${how}`, media: { url: r.media.url, pathname: r.media.pathname, kind: "image", name: a.done.pictureName } };
    }
    case "make_video": {
      if (!adVideoEnabled()) return { ok: false, error: a.errors.featureOff };
      // The language and the kind only when the model gave them: left out, the store's own video language decides the language, and the kind
      // is an ad when a product is named (productId below), else what the page is for (the action resolves them, with the same rule as the card).
      const r = await createVideoAction(store.id, {
        tier,
        topic: String(args.idea),
        productId,
        voice: "shilan",
        publish: false,
        targets: [],
        review,
        ...(typeof args.language === "string" ? { lang: args.language } : {}),
        ...(typeof args.kind === "string" ? { kind: args.kind } : {}),
      });
      if (!r.ok) return { ok: false, error: r.error };
      const how = r.reviewed ? `\n${t.publish.ai.reviewedNote(r.reviewed.summary)}` : "";
      return { ok: true, text: `${a.done.videoStarted}${how}`, jobId: r.id };
    }
    case "post_now":
    case "schedule_post": {
      const problem = await postProblem(tenantId, args, atts, conns);
      if (problem) return { ok: false, error: problem.why === "notConnected" ? a.errors.notConnected(problem.platform) : a.errors[problem.why] };
      const targets = args.targets as ("FB" | "IG")[];
      const m = args.media ? att(args.media) : undefined;
      // The accounts the person chose in the chat (a scheduled post keeps them: the job that publishes it later has no chat to ask).
      const accounts = chosenPostAccounts(targets);
      const post = {
        caption: String(args.caption ?? ""),
        targets,
        ...(m ? { media: { url: m.url, pathname: m.pathname, type: m.kind === "image" ? ("IMAGE" as const) : ("VIDEO" as const) } } : {}),
        ...(productId ? { productId } : {}),
        ...(accounts ? { accounts } : {}),
      };
      if (tool === "schedule_post") {
        const r = await schedulePublishAction(post, String(args.when));
        return r.ok ? { ok: true, text: a.done.scheduled(String(args.when).replace("T", " ")) } : { ok: false, error: r.error };
      }
      const r = await publishAction(input.igDeadlineMs && targets.includes("IG") ? { ...post, igDeadlineMs: input.igDeadlineMs } : post);
      if (!r.ok) return { ok: false, error: r.error };
      const went = r.results.some((o) => o.ok || o.pending);
      const lines = r.results.map((o) => `${o.target === "FB" ? "Facebook" : o.target === "IG" ? "Instagram" : o.target}: ${o.ok || o.pending ? a.done.okMark : a.done.failMark}`);
      return went ? { ok: true, text: `${a.done.posted}\n${lines.join("\n")}` } : { ok: false, error: `${a.done.postFailed}\n${lines.join("\n")}` };
    }
    case "set_auto_replies": {
      const r = await saveStoreSettingsAction(store.id, { automationEnabled: !!args.on });
      return r.ok ? { ok: true, text: args.on ? a.done.repliesOn : a.done.repliesOff } : { ok: false, error: r.error };
    }
    case "set_autopilot": {
      const r = await saveStoreSettingsAction(store.id, { autoMode: String(args.mode), ...(typeof args.perDay === "number" ? { autoPerDay: args.perDay } : {}) });
      return r.ok ? { ok: true, text: a.done.setting } : { ok: false, error: r.error };
    }
    case "set_shop_options": {
      const r = await saveStoreSettingsAction(store.id, {
        ...(typeof args.likeComments === "boolean" ? { likeComments: args.likeComments } : {}),
        ...(typeof args.autoHideSpam === "boolean" ? { autoHideSpam: args.autoHideSpam } : {}),
        ...(typeof args.aiReplies === "boolean" ? { aiReplies: args.aiReplies } : {}),
        ...(typeof args.expiryDays === "number" ? { expiryDays: args.expiryDays } : {}),
        ...(typeof args.defaultDm === "string" ? { defaultDm: args.defaultDm } : {}),
        ...(typeof args.deliveryFee === "string" ? { deliveryFee: args.deliveryFee } : {}),
        ...(typeof args.deliveryTime === "string" ? { deliveryTime: args.deliveryTime } : {}),
        ...(typeof args.aiBrief === "string" ? { aiBrief: args.aiBrief } : {}),
      });
      return r.ok ? { ok: true, text: a.done.setting } : { ok: false, error: r.error };
    }
    case "add_product": {
      const photos = ((args.photos as string[]) ?? []).map((id) => att(id)).filter((x) => x?.kind === "image").map((x) => x!.url);
      const r = await saveProductAction(store.id, null, {
        name: String(args.name),
        description: String(args.description ?? ""),
        photos,
        variants: [{ label: "", price: String(args.price), currency: "IQD", inStock: args.inStock !== false }],
      });
      return r.ok ? { ok: true, text: a.done.productAdded } : { ok: false, error: r.error };
    }
    case "archive_product": {
      if (!productId) return { ok: false, error: a.errors.productNotFound };
      const r = await archiveProductAction(store.id, productId);
      return r.ok ? { ok: true, text: a.done.productHidden } : { ok: false, error: r.error };
    }
    case "set_whatsapp_number": {
      const r = await saveWhatsAppAction(String(args.number));
      return r.ok ? { ok: true, text: a.done.numberSaved } : { ok: false, error: r.error };
    }
    case "set_daily_video": {
      if (!adVideoEnabled()) return { ok: false, error: a.errors.featureOff };
      // What the card did not show is left as it was: the mode, the hour, the kind of video and the video language already chosen stay.
      const cur = await db.store.findUnique({ where: { id: store.id }, select: { videoAutoHour: true, videoAutoTier: true } });
      const keepTier = cur?.videoAutoTier === "LITE" || cur?.videoAutoTier === "PRO" ? cur.videoAutoTier : tier;
      const keepHour = typeof cur?.videoAutoHour === "number" ? cur.videoAutoHour : 19;
      // The mode and the language are saved only when the card showed them: left out (the owner only changed the language or the hour),
      // the daily video stays on or off as it was and the store's video language stays as it is (the action does not touch them).
      const r = await saveVideoAutoAction(store.id, {
        ...(typeof args.mode === "string" ? { mode: args.mode } : {}),
        tier: keepTier,
        hour: typeof args.hour === "number" ? args.hour : keepHour,
        ...(typeof args.language === "string" ? { lang: args.language } : {}),
      });
      return r.ok ? { ok: true, text: a.done.setting } : { ok: false, error: r.error };
    }
    default:
      // A tool of the newsroom, in a shop: not on its list.
      return { ok: false, error: a.errors.badAction };
  }
}
