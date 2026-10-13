"use server";

import { adVideoEnabled } from "@/lib/advideo/enabled";
import { imageEnabled } from "@/lib/ai/image";
import { claimSlot, refundSlot, takeDaily } from "@/lib/ai/slots";
import { askAssistant, cleanTurns, plainName, type AttachmentInfo, type ChatTurn } from "@/lib/assistant/ask";
import { assistantCaps, ASSISTANT_SLOTS, NO_SHOP_CAPS, REFUNDS_PER_DAY } from "@/lib/assistant/caps";
import { loadAssistantState } from "@/lib/assistant/state";
import { parseProposal, proposalLines, type ToolName } from "@/lib/assistant/tools";
import { maxPlanOpen } from "@/lib/billing/prices";
import { db } from "@/lib/db";
import { dict, getLang } from "@/lib/i18n";
import { isJpegPath, isOwnBlobUrl } from "@/lib/merchant/caption";
import { can } from "@/lib/newsroom/roles";
import { limitsOf } from "@/lib/shop/tenant-plans";
import { randomUUID } from "node:crypto";
import { publishAction } from "../actions";
import { saveStoreSettingsAction } from "../automation/actions";
import { generateAiImageAction } from "../publish/ai-image-action";
import { schedulePublishAction } from "../publish/schedule-actions";
import { createVideoAction, saveVideoAutoAction } from "../video/actions";
import { currentWorkspace, loadAccountLists, loadConnections } from "../data";

/** A file the owner attached in the chat, as the screen keeps it. The address is checked here, never trusted. */
export interface ChatAttachment {
  id: string;
  url: string;
  pathname: string;
  kind: "image" | "video";
  name: string;
}

export type AssistantResult =
  | {
      ok: true;
      reply: string;
      followups: string[];
      /** An action the owner may confirm: the values as the card shows them. */
      proposal: { tool: ToolName; args: Record<string, unknown>; title: string; lines: { label: string; value: string }[]; nonce: string } | null;
    }
  /** `contact`: the person is offered the support number with the message. */
  | { ok: false; error: string; contact: boolean };

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

/** Only the workspace's own uploads count as attachments. */
function cleanAttachments(raw: unknown, tenantId: string): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatAttachment[] = [];
  for (const x of raw.slice(0, 10)) {
    const a = x as Partial<ChatAttachment> | null;
    if (!a || typeof a.id !== "string" || !ID.test(a.id) || typeof a.url !== "string" || typeof a.pathname !== "string") continue;
    if (a.kind !== "image" && a.kind !== "video") continue;
    if (!isOwnBlobUrl(a.url, tenantId) || !a.pathname.startsWith(`merchant/${tenantId}/`) || a.pathname.includes("..")) continue;
    out.push({ id: a.id, url: a.url, pathname: a.pathname, kind: a.kind, name: String(a.name ?? "").slice(0, 80) });
  }
  return out;
}

/**
 * The shop an action is for, and the product it names: the product's shop when a product is named (by its exact name,
 * or a name that only one product contains), else the shop of the connected account, else the oldest. Used both when
 * a card is made (so it can show the shop) and when it runs.
 */
async function resolveShop(tenantId: string, connectedIds: string[], productHint: unknown) {
  const [stores, products] = await Promise.all([
    db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: 15, select: { id: true, name: true, igUsername: true, fbPageId: true, igUserId: true } }),
    db.product.findMany({ where: { active: true, store: { tenantId } }, select: { id: true, name: true, storeId: true }, take: 300 }),
  ]);
  let store = stores.find((s) => (!!s.fbPageId && connectedIds.includes(s.fbPageId)) || (!!s.igUserId && connectedIds.includes(s.igUserId))) ?? stores[0];
  if (!store) return { ok: false as const, why: "noShop" as const };
  let productId: string | null = null;
  if (typeof productHint === "string" && productHint.trim()) {
    const want = productHint.trim().toLowerCase();
    const exact = products.filter((p) => p.name.trim().toLowerCase() === want);
    const loose = exact.length ? exact : products.filter((p) => p.name.toLowerCase().includes(want));
    if (loose.length !== 1) return { ok: false as const, why: "productNotFound" as const };
    productId = loose[0].id;
    store = stores.find((s) => s.id === loose[0].storeId) ?? store;
  }
  return { ok: true as const, store, productId, shopName: store.name || (store.igUsername ? `@${store.igUsername}` : "") };
}

const baghdadNow = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

/** One question to the assistant. It explains, looks, and may propose one action; it changes nothing by itself. */
export async function askAssistantAction(input: { workspaceId: string; messages: ChatTurn[]; attachments?: ChatAttachment[] }): Promise<AssistantResult> {
  const lang = await getLang();
  const t = dict(lang);
  const a = t.assistant;
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: a.signIn, contact: false };
  if (ws.kind !== "MERCHANT") return { ok: false, error: a.notShop, contact: true };
  // The answers look at billing and automation settings: only people who can open those may ask.
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed, contact: false };
  // The screen was opened for another workspace than the one the session is in now (a tab left behind).
  if (input?.workspaceId !== ws.id) return { ok: false, error: a.errors.otherWorkspace, contact: false };
  const turns = cleanTurns(input?.messages);
  if (!turns.length) return { ok: false, error: a.failed, contact: true };
  const attachments = cleanAttachments(input?.attachments, ws.id);

  const limits = await limitsOf(ws.id);
  const noShop = limits.aiUsd <= 0;
  const slot = await claimSlot(ws.id, ASSISTANT_SLOTS, noShop ? NO_SHOP_CAPS : assistantCaps(limits.aiUsd));
  if (!slot.ok) return { ok: false, error: slot.error === "daily" ? a.limit : a.limitMonth, contact: true };

  try {
    const conns = await loadConnections(ws.id);
    const state = await loadAssistantState(ws.id, {
      facebook: { connected: !!conns.META_FACEBOOK.connected, name: conns.META_FACEBOOK.name },
      instagram: { connected: !!conns.META_INSTAGRAM.connected, name: conns.META_INSTAGRAM.name },
      tiktok: { connected: !!conns.TIKTOK.connected },
      youtube: { connected: !!conns.YOUTUBE.connected },
    });
    const video = adVideoEnabled();
    const uiNames: Record<string, string> = {
      today: t.nav.today,
      comments: t.nav.comments,
      messages: t.nav.messages,
      orders: t.nav.orders,
      whatsapp: t.wa.nav,
      publish: t.nav.publish,
      ...(video ? { ai_video: t.nav.video } : {}),
      auto_replies: t.nav.automation,
      auto_posts: t.nav.autopilot,
      boost: t.nav.boost,
      insights: t.nav.insights,
      settings: t.layout.settings,
      plan_and_billing: t.billing.title,
    };
    const hasMax = state.shops.some((s) => s.plan === "MAX");
    const infos: AttachmentInfo[] = attachments.map((x) => ({ id: x.id, kind: x.kind, name: x.name }));
    const answer = await askAssistant({
      tenantId: ws.id,
      lang,
      turns,
      uiNames,
      state,
      features: { max: maxPlanOpen() || hasMax, video, pictures: imageEnabled() },
      attachments: infos,
      nowBaghdad: baghdadNow(),
      uncounted: noShop,
    });
    const p = answer.action;
    let proposal: Extract<AssistantResult, { ok: true }>["proposal"] = null;
    if (p) {
      const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
      const shop = await resolveShop(ws.id, connectedIds, (p.args as { product?: unknown }).product).catch(() => null);
      const files = Object.fromEntries(attachments.map((x) => [x.id, plainName(x.name) || x.kind]));
      proposal = {
        tool: p.tool,
        args: p.args,
        title: a.tools[p.tool],
        lines: proposalLines(p, a.fields, { files, shop: shop?.ok ? shop.shopName : undefined }),
        nonce: randomUUID().replace(/-/g, "").slice(0, 16),
      };
    }
    return { ok: true, reply: answer.reply, followups: answer.followups, proposal };
  } catch {
    // No answer was made: the place goes back, a few times a day (a failure after a paid call must not loop for free).
    if ((await takeDaily(ws.id, "assistant_refund_day", 1, REFUNDS_PER_DAY).catch(() => 0)) > 0) {
      await refundSlot(ws.id, ASSISTANT_SLOTS, slot).catch(() => undefined);
    }
    return { ok: false, error: a.failed, contact: true };
  }
}

/** Confirmations a workspace may give in a day: a cap on what a confused or fooled model could make happen. */
const ACTIONS_PER_DAY = 40;
const POSTS_PER_DAY = 15;

/**
 * Runs a proposal the owner confirmed. Everything is checked again here (the screen is not trusted): the tool must
 * be on the list, the arguments must fit, every file must be the workspace's own upload, and each tool goes through
 * the same server action the app's own screens use, with that action's own checks and limits.
 */
export async function runToolAction(input: { workspaceId: string; nonce: string; tool: string; args: unknown; attachments?: ChatAttachment[] }): Promise<ToolResult> {
  const lang = await getLang();
  const t = dict(lang);
  const a = t.assistant;
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: a.signIn };
  if (ws.kind !== "MERCHANT") return { ok: false, error: a.notShop };
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };

  if (input?.workspaceId !== ws.id) return { ok: false, error: a.errors.otherWorkspace };
  const atts = cleanAttachments(input?.attachments, ws.id);
  const proposal = parseProposal({ tool: input?.tool, args: input?.args }, new Set(atts.map((x) => x.id)));
  if (!proposal || typeof input?.nonce !== "string" || !/^[a-f0-9]{16}$/.test(input.nonce)) return { ok: false, error: a.errors.badAction };
  // One card runs once, whatever the screen does (a reload, a second tab, a double press that got through).
  if ((await takeDaily(ws.id, `chatrun_${input.nonce}`, 1, 1)) < 1) return { ok: false, error: a.errors.alreadyRun };
  if ((await takeDaily(ws.id, "chat_action_day", 1, ACTIONS_PER_DAY)) < 1) return { ok: false, error: a.errors.actionsLimit };
  // Publishing is the costly kind of mistake: its own, lower number.
  if ((proposal.tool === "post_now" || proposal.tool === "schedule_post") && (await takeDaily(ws.id, "chat_post_day", 1, POSTS_PER_DAY)) < 1) return { ok: false, error: a.errors.actionsLimit };

  // The shop the action is for (the same rule as the card used to show it).
  const conns = await loadConnections(ws.id);
  const connectedIds = [conns.META_FACEBOOK.accountId, conns.META_INSTAGRAM.accountId].filter((id): id is string => !!id);
  const args = proposal.args as Record<string, unknown>;
  const shop = await resolveShop(ws.id, connectedIds, args.product);
  if (!shop.ok) return { ok: false, error: a.errors[shop.why] };
  const { store, productId } = shop;
  const att = (id: unknown) => atts.find((x) => x.id === id);
  const tier = (await limitsOf(ws.id)).videos.PRO > 0 ? "PRO" : "LITE";
  const connected = { FB: !!conns.META_FACEBOOK.connected, IG: !!conns.META_INSTAGRAM.connected };

  switch (proposal.tool) {
    case "make_picture": {
      if (!imageEnabled()) return { ok: false, error: a.errors.featureOff };
      const refUrls = ((args.references as string[]) ?? []).map((id) => att(id)).filter((x) => x?.kind === "image").map((x) => x!.url);
      const r = await generateAiImageAction({ idea: String(args.idea), productId, refUrls, shape: args.shape === "portrait" ? "portrait" : "square", review: true });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: a.done.picture, media: { url: r.media.url, pathname: r.media.pathname, kind: "image", name: a.done.pictureName } };
    }
    case "make_video": {
      if (!adVideoEnabled()) return { ok: false, error: a.errors.featureOff };
      const r = await createVideoAction(store.id, { tier, topic: String(args.idea), productId, voice: "shilan", publish: false, targets: [], review: true });
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, text: a.done.videoStarted, jobId: r.id };
    }
    case "post_now":
    case "schedule_post": {
      const targets = args.targets as ("FB" | "IG")[];
      for (const tg of targets) if (!connected[tg]) return { ok: false, error: a.errors.notConnected(tg === "FB" ? "Facebook" : "Instagram") };
      // With several Pages (or Instagram accounts) the person chooses which, in Publish: nothing is guessed here.
      const lists = await loadAccountLists(ws.id);
      if ((targets.includes("FB") && lists.META_FACEBOOK.length > 1) || (targets.includes("IG") && lists.META_INSTAGRAM.length > 1)) return { ok: false, error: a.errors.severalAccounts };
      const m = args.media ? att(args.media) : undefined;
      if (args.media && !m) return { ok: false, error: a.errors.badAction };
      if (m && m.kind === "image" && targets.includes("IG") && !isJpegPath(m.pathname)) return { ok: false, error: a.errors.needJpeg };
      const post = {
        caption: String(args.caption ?? ""),
        targets,
        ...(m ? { media: { url: m.url, pathname: m.pathname, type: m.kind === "image" ? ("IMAGE" as const) : ("VIDEO" as const) } } : {}),
        ...(productId ? { productId } : {}),
      };
      if (proposal.tool === "schedule_post") {
        const r = await schedulePublishAction(post, String(args.when));
        return r.ok ? { ok: true, text: a.done.scheduled(String(args.when).replace("T", " ")) } : { ok: false, error: r.error };
      }
      const r = await publishAction(post);
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
    case "set_daily_video": {
      if (!adVideoEnabled()) return { ok: false, error: a.errors.featureOff };
      // What the card did not show is left as it was: the hour and the kind of video already chosen stay.
      const cur = await db.store.findUnique({ where: { id: store.id }, select: { videoAutoHour: true, videoAutoTier: true } });
      const keepTier = cur?.videoAutoTier === "LITE" || cur?.videoAutoTier === "PRO" ? cur.videoAutoTier : tier;
      const keepHour = typeof cur?.videoAutoHour === "number" ? cur.videoAutoHour : 19;
      const r = await saveVideoAutoAction(store.id, { mode: String(args.mode), tier: keepTier, hour: typeof args.hour === "number" ? args.hour : keepHour });
      return r.ok ? { ok: true, text: a.done.setting } : { ok: false, error: r.error };
    }
  }
}
