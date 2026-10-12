import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { openOrder } from "@/lib/orders/auto";
import { aiFor } from "@/lib/ai/for-store";
import { allowanceOf } from "@/lib/ai/meter";
import { classifyText } from "./classify";
import { cityIn } from "@/lib/orders/cities";
import { extractDetails, followupText, hasDetails, isYes, nextStep, type CollectOrder, type Details } from "@/lib/orders/collect";
import { normalizePhone } from "@/lib/merchant/phone";
import { alternativeLine, answerText, COPY, DEFAULT_SAMPLES, dmText, fbCardElements, feeFor, waText, type CardProduct } from "./compose";
import { gate, gateDm } from "./gate";
import { buildCommentJobs, buildDmJobs, type JobSpec } from "./jobs";
import { productNamedIn, typedText } from "@/lib/whatsapp/webhook";
import { accountFor, fetchPostCreatedAt, type MetaPlatform, type ShopPlatform } from "./meta-client";
import type { Lang } from "./money";
import { dailyCap, SHOP_LIMITS, type StorePlan } from "./plans";
import { decideComment, decideDm, limitDecision, MIN_CONFIDENCE } from "./policy";
import { runJob } from "./outbox";
import { aiVaryUsed, countAiVary } from "./quota";
import { smartTry } from "./smart-glue";
import { varySample } from "./vary";

const DAY = 86_400_000;
/** The kinds of buyer message the assistant may answer in the owner's words (complaints and abuse stay with the owner). */
const SMART_TYPES: readonly string[] = ["QUESTION", "NEGOTIATION", "OTHER", "ORDER"];
/** Before Meta's 24 h messaging window closes. */
const FOLLOWUP_MS = 20 * 3_600_000;
/** Meta allows a private reply only within 7 days of the comment. */
const PRIVATE_REPLY_WINDOW = 7 * DAY;

export function jitterMs(rand: () => number = Math.random): number {
  return 8_000 + Math.floor(rand() * 22_000);
}
/** Midnight in Baghdad (UTC+3 all year), where the shops' days begin. */
export function startOfShopDay(d: Date): Date {
  const BAGHDAD = 3 * 3_600_000;
  return new Date(Math.floor((d.getTime() + BAGHDAD) / 86_400_000) * 86_400_000 - BAGHDAD);
}
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pickOne = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

const load = (id: string) =>
  db.conversationMessage.findUnique({
    where: { id },
    include: { store: { include: { tenant: { select: { slug: true, whatsappNumber: true } } } } },
  });
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;
type Msg = Loaded & { store: NonNullable<Loaded["store"]> };
type Store = Msg["store"];

/**
 * Handle one stored comment or DM: gate → classify → decide → compose →
 * outbox → send. Idempotent: a message with an outcome is never processed
 * again, and jobs are unique per (message, kind).
 */
export async function processMessage(messageId: string, opts: { delay?: boolean } = {}): Promise<void> {
  const msg = await load(messageId);
  // Only what buyers sent: the shop's own manual sends and templates are stored too, and must never be "answered".
  if (!msg?.store || msg.outcome || msg.direction !== "INBOUND") return;
  const jobIds = msg.channelType === "DM" ? await planDm(msg as Msg) : await planComment(msg as Msg);
  if (!jobIds.length) return;
  if (opts.delay) await sleep(jitterMs());
  for (const id of jobIds) await runJob(id, { immediate: true });
}

/** A message the AI could not label: said plainly when it is the month's allowance that ran out, so the owner knows why it waits. */
async function unlabelledReason(store: { tenantId: string }): Promise<"ai_limit" | "unclear"> {
  try {
    return (await allowanceOf({ scope: store.tenantId })).percent >= 100 ? "ai_limit" : "unclear";
  } catch {
    return "unclear";
  }
}

async function finish(id: string, outcome: "AUTO_REPLIED" | "FLAGGED" | "SKIPPED", reason: string | null, extra: Prisma.ConversationMessageUpdateInput = {}): Promise<void> {
  await db.conversationMessage.update({ where: { id }, data: { outcome, outcomeReason: reason, ...extra } });
}

function sentToday(storeId: string, now: Date): Promise<number> {
  return db.outboxJob.count({
    // Replies waiting to go out count too: a burst of comments must not all pass the cap before the first is sent.
    where: { storeId, status: { in: ["SENT", "PENDING"] }, kind: { in: ["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"] }, updatedAt: { gte: startOfShopDay(now) } },
  });
}

async function loadProduct(id: string | null): Promise<(CardProduct & { id: string }) | null> {
  if (!id) return null;
  const p = await db.product.findUnique({ where: { id }, include: { variants: { orderBy: { position: "asc" } } } });
  if (!p?.active) return null;
  return { id: p.id, name: p.name, photos: p.photos, variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })) };
}

/** Another product of the store that is in stock, newest first: offered when the asked one is sold out. */
async function alternativeProduct(storeId: string, notId: string): Promise<CardProduct | null> {
  const p = await db.product.findFirst({
    where: { storeId, active: true, id: { not: notId }, variants: { some: { inStock: true, amountMinor: { gt: 0 } } } },
    orderBy: { updatedAt: "desc" },
    include: { variants: { where: { inStock: true }, orderBy: { position: "asc" } } },
  });
  return p ? { name: p.name, photos: p.photos, variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })) } : null;
}

function waUrl(tenant: Store["tenant"], text: string): string | null {
  return tenant.whatsappNumber ? `${SHOP_ORIGIN}/w/${tenant.slug}?t=${encodeURIComponent(text)}` : null;
}

async function vary(store: Store, sample: string, lang: Lang): Promise<string> {
  if ((await aiVaryUsed(store.id)) >= SHOP_LIMITS[store.plan as StorePlan].aiVaryPerMonth) return sample;
  const r = await varySample(sample, lang, undefined, aiFor(store));
  if (r.ai) await countAiVary(store.id);
  return r.text;
}

async function createJobs(storeId: string, messageId: string, specs: JobSpec[], productId: string | null = null): Promise<string[]> {
  const ids: string[] = [];
  for (const s of specs) {
    // reserved for the immediate run; the sweep only takes it if that run died
    const nextAttemptAt = new Date(Date.now() + 2 * 60_000);
    if (s.kind === "DM_PHOTOS" && s.recipientId) {
      // One photo job per buyer per product: a fixed id makes a racing second insert fail instead of sending twice.
      try {
        const job = await db.outboxJob.create({
          data: { id: `dmphotos_${storeId}_${s.recipientId}_${productId ?? "none"}`, storeId, messageId, kind: s.kind, payload: s.payload as Prisma.InputJsonValue, recipientId: s.recipientId, nextAttemptAt },
          select: { id: true },
        });
        ids.push(job.id);
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e;
      }
      continue;
    }
    // Only jobs this call created are returned for the immediate run; one that already exists
    // belongs to the run that made it, or to the sweep.
    try {
      const job = await db.outboxJob.create({
        data: { storeId, messageId, kind: s.kind, payload: s.payload as Prisma.InputJsonValue, recipientId: s.recipientId ?? null, nextAttemptAt },
        select: { id: true },
      });
      ids.push(job.id);
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  return ids;
}

async function ensurePost(store: Store, platform: MetaPlatform, postId: string, now: Date) {
  const key = { storeId_platform_externalPostId: { storeId: store.id, platform, externalPostId: postId } };
  const found = await db.postAutomation.findUnique({ where: key });
  if (found) return found;
  const acc = await accountFor(store, platform);
  const created = (acc && (await fetchPostCreatedAt(acc, postId))) || now;
  return db.postAutomation.upsert({
    where: key,
    create: { storeId: store.id, platform, externalPostId: postId, postCreatedAt: created, activeUntil: new Date(created.getTime() + store.expiryDays * DAY) },
    update: {},
  });
}

async function planComment(msg: Msg): Promise<string[]> {
  const store = msg.store;
  const now = new Date();
  const platform = msg.platform as MetaPlatform;
  const postId = msg.externalThreadId;
  const commentId = msg.externalMessageId;
  if (!postId || !commentId) {
    await finish(msg.id, "SKIPPED", "no_post");
    return [];
  }
  const post = await ensurePost(store, platform, postId, now);
  const threadKeys = [msg.parentCommentId, commentId].filter((k): k is string => !!k);
  const [newer, repliedBefore, paused, sent] = await Promise.all([
    db.postAutomation.count({ where: { storeId: store.id, enabled: true, activeUntil: { gt: now }, postCreatedAt: { gt: post.postCreatedAt } } }),
    msg.authorId
      ? db.conversationMessage.count({ where: { storeId: store.id, authorId: msg.authorId, externalThreadId: postId, outcome: "AUTO_REPLIED", createdAt: { gt: new Date(now.getTime() - DAY) }, NOT: { id: msg.id } } })
      : Promise.resolve(0),
    db.threadPause.count({ where: { tenantId: store.tenantId, platform, threadKey: { in: threadKeys } } }),
    sentToday(store.id, now),
  ]);
  const plan = store.plan as StorePlan;
  const g = gate({
    now,
    store,
    self: { ids: [store.fbPageId, store.igUserId].filter((x): x is string => !!x), username: platform === "META_INSTAGRAM" ? store.igUsername : null },
    author: { id: msg.authorId, name: msg.authorHandle },
    post,
    newerAutomatedPosts: newer,
    postSlots: SHOP_LIMITS[plan].posts,
    repliedToAuthorOnPostToday: repliedBefore > 0,
    threadPaused: paused > 0,
    sentToday: sent,
    dailyCap: dailyCap(plan, store.dailyCap),
  });
  if (!g.ok && g.reason !== "author_limit") {
    await finish(msg.id, "SKIPPED", g.reason);
    return [];
  }
  // Already answered this author on this post today: classify anyway, so spam is still hidden and complaints still flagged.
  const limited = !g.ok;

  const product = await loadProduct(post.productId);
  const c = await classifyText(msg.content ?? "", { channel: "comment", productName: product?.name, ai: aiFor(store) });
  if (!c) {
    await finish(msg.id, "FLAGGED", await unlabelledReason(store));
    return [];
  }
  const templateId = post.templateId ?? store.defaultTemplateId;
  const template = templateId ? await db.automationTemplate.findUnique({ where: { id: templateId } }) : null;
  const full = decideComment(c, {
    hasProduct: !!product && product.variants.length > 0,
    hasDefaultDm: !!store.defaultDm?.trim(),
    likeComments: store.likeComments,
    autoHideSpam: store.autoHideSpam,
    isFacebook: platform === "META_FACEBOOK",
    whatsappAlways: template?.whatsappAlways ?? false,
    canPrivateReply: now.getTime() - msg.createdAt.getTime() < PRIVATE_REPLY_WINDOW,
  });
  const decision = limited ? limitDecision(full) : full;

  const pub = decision.actions.find((a) => a.kind === "PUBLIC_REPLY");
  const priv = decision.actions.find((a) => a.kind === "PRIVATE_REPLY");

  // Smart replies: the assistant writes the first message (and the public line) in the owner's words. The fixed
  // texts below are what goes out when they are off, over the month's allowance, or the writing fails the guard.
  // They are asked for first, so the wording variation (one more AI call) is not paid for a line that is replaced.
  let defaultDm = store.defaultDm;
  // The assistant said the team has to confirm something: the comment goes to the owner's "needs you" pile.
  let smartNeedsOwner = false;
  let smartDm: string | null = null;
  let smartPublic: string | null = null;
  if (store.aiReplies && priv?.kind === "PRIVATE_REPLY") {
    const link = product && priv.whatsapp ? waUrl(store.tenant, waText(product, c.language)) : null;
    const s = await smartTry({ store, kind: "dm_first", lang: c.language, message: msg.content ?? "", product, waLink: link });
    if (s) {
      smartNeedsOwner = s.needsOwner;
      smartDm = s.text;
      if (pub?.kind === "PUBLIC_REPLY") {
        const sp = await smartTry({ store, kind: "public", lang: c.language, message: msg.content ?? "", product, waLink: null });
        if (sp) smartPublic = sp.text;
      }
    }
  }

  let publicText: string | null = null;
  if (pub?.kind === "PUBLIC_REPLY") {
    if (smartPublic !== null) publicText = smartPublic;
    else {
      const own = pub.style === "answer" ? template?.publicSamples : template?.thanksSamples;
      const samples = own?.length ? own : DEFAULT_SAMPLES[pub.style][c.language];
      publicText = await vary(store, pickOne(samples), c.language);
    }
  }

  let card: { text: string; elements: ReturnType<typeof fbCardElements> } | null = null;
  if (priv?.kind === "PRIVATE_REPLY" && priv.content === "card" && product) {
    if (smartDm !== null) {
      card = { text: smartDm, elements: [] };
    } else {
      const wa = priv.whatsapp ? waUrl(store.tenant, waText(product, c.language)) : null;
      const greeting = template?.dmGreeting === false ? COPY[c.language].hello : await vary(store, COPY[c.language].hello, c.language);
      card = { text: dmText({ greeting, product, store, lang: c.language, waUrl: wa }), elements: fbCardElements(product, store, c.language, wa) };
    }
  } else if (priv?.kind === "PRIVATE_REPLY" && priv.content === "default_dm" && smartDm !== null) {
    defaultDm = smartDm;
  }

  const specs = buildCommentJobs({ decision, platform, commentId, authorName: msg.authorHandle, publicText, card, defaultDm });
  const ids = await createJobs(store.id, msg.id, specs);
  if (limited && !decision.flag && !specs.length) {
    await finish(msg.id, "SKIPPED", "author_limit", { commentType: c.type, intent: c.intent, language: c.language, confidence: c.confidence });
    // No second reply for this buyer today, but an order is still an order.
    if (c.type === "ORDER" && c.confidence >= MIN_CONFIDENCE) await openOrder(msg, product);
    return [];
  }
  const replied = specs.some((s) => s.kind === "PUBLIC_REPLY" || s.kind === "PRIVATE_REPLY");
  await finish(msg.id, replied ? "AUTO_REPLIED" : "FLAGGED", decision.flag ?? (replied ? (smartNeedsOwner ? "needs_you" : null) : "no_action"), {
    commentType: c.type, intent: c.intent, language: c.language, confidence: c.confidence, boundProductId: product?.id ?? null,
  });
  // A buyer asking to order is an order whatever the shop answered, even when it only flagged the comment for the merchant.
  // Low confidence is a guess, and a guess must not open an order the merchant then has to sort out.
  if (c.type === "ORDER" && c.confidence >= MIN_CONFIDENCE) await openOrder(msg, product);
  return ids;
}

/** Messenger/Instagram: the product whose card we sent this buyer in the last 7 days. */
async function boundProduct(storeId: string, senderId: string, now: Date) {
  const bound = await db.outboxJob.findFirst({
    where: { storeId, kind: "PRIVATE_REPLY", status: "SENT", recipientId: senderId, updatedAt: { gt: new Date(now.getTime() - PRIVATE_REPLY_WINDOW) } },
    orderBy: { updatedAt: "desc" },
    select: { message: { select: { boundProductId: true } } },
  });
  return loadProduct(bound?.message.boundProductId ?? null);
}

/**
 * WhatsApp has no comment card to bind the thread: the product the message names
 * (the shop's wa.me link pre-fills "<product> — <price>"), else the one this buyer
 * asked about in the last 7 days.
 */
async function whatsappProduct(storeId: string, senderId: string, text: string, now: Date) {
  const products = await db.product.findMany({ where: { storeId, active: true }, select: { id: true, name: true } });
  const named = productNamedIn(text, products);
  if (named) return loadProduct(named);
  const last = await db.conversationMessage.findFirst({
    where: { storeId, platform: "WHATSAPP", authorId: senderId, boundProductId: { not: null }, createdAt: { gt: new Date(now.getTime() - PRIVATE_REPLY_WINDOW) } },
    orderBy: { createdAt: "desc" },
    select: { boundProductId: true },
  });
  return loadProduct(last?.boundProductId ?? null);
}

async function planDm(msg: Msg): Promise<string[]> {
  const store = msg.store;
  const now = new Date();
  const platform = msg.platform as ShopPlatform;
  const senderId = msg.authorId ?? msg.externalThreadId;
  if (!senderId) {
    await finish(msg.id, "SKIPPED", "no_sender");
    return [];
  }
  const [paused, sent] = await Promise.all([
    db.threadPause.count({ where: { tenantId: store.tenantId, platform, threadKey: senderId } }),
    sentToday(store.id, now),
  ]);
  const g = gateDm({ store, threadPaused: paused > 0, sentToday: sent, dailyCap: dailyCap(store.plan as StorePlan, store.dailyCap) });
  if (!g.ok) {
    await finish(msg.id, "SKIPPED", g.reason);
    return [];
  }

  const whatsapp = platform === "WHATSAPP";
  // typedText: a media token's caption, or a voice note's transcript ("[audio] <words>"), on every platform.
  const text = typedText(msg.content ?? "").trim();

  // A buyer in the middle of giving their order details (or whose order comment we answered privately): this message is the next answer.
  const collecting = text ? ((await collectingOrder(store.id, senderId, now)) ?? (whatsapp ? null : await commentOrder(store.id, senderId, now))) : null;
  if (collecting) {
    const cp = await loadProduct(collecting.productId);
    const inStock = inStockOf(cp);
    const d = await extractDetails(text, inStock, aiFor(store));
    if (hasDetails(d) || isYes(text)) {
      const lang = await buyerLang(store.id, senderId);
      const reply = await collectStep(store, collecting, d, text, lang, msg.authorHandle, inStock);
      const ids = await createJobs(store.id, msg.id, [{ kind: "DM_ANSWER", payload: { recipientId: senderId, message: { text: reply } }, recipientId: senderId }]);
      await finish(msg.id, "AUTO_REPLIED", null, { commentType: "ORDER", language: lang, boundProductId: cp?.id ?? null });
      return ids;
    }
  }

  const product = whatsapp ? await whatsappProduct(store.id, senderId, text, now) : await boundProduct(store.id, senderId, now);
  const photosSent = product ? await db.outboxJob.count({ where: { id: `dmphotos_${store.id}_${senderId}_${product.id}` } }) : 0;
  const c = text ? await classifyText(text, { channel: "dm", productName: product?.name, ai: aiFor(store) }) : null;
  const decision = decideDm(c, { boundProduct: !!product, firstReply: photosSent === 0, hasPhotos: (product?.photos.length ?? 0) > 0 });
  const ordering = c?.type === "ORDER" && c.confidence >= MIN_CONFIDENCE;
  const city = cityIn(text);
  const orderId = ordering ? await openOrder(msg, product, { city, deliveryFeeMinor: feeFor(store, city) }) : null;

  let answer: string | null = null;
  const ans = decision.actions.find((a) => a.kind === "DM_ANSWER");
  if (ans?.kind === "DM_ANSWER" && product && c && ordering && orderId) {
    // An order: ask for the details the order still lacks, in this same chat.
    const order = await db.order.findUnique({ where: { id: orderId }, select: COLLECT_SELECT });
    if (order && order.collect !== "done") {
      const inStock = inStockOf(product);
      const d = await extractDetails(text, inStock, aiFor(store));
      // On WhatsApp the sender id is the buyer's own number.
      if (whatsapp && !d.phone) {
        const p = normalizePhone(`+${senderId}`);
        if (p.ok) d.phone = p.digits;
      }
      answer = await collectStep(store, order, d, text, c.language, msg.authorHandle, inStock);
    }
  }
  if (!answer && ans?.kind === "DM_ANSWER" && product && c) {
    // Inside WhatsApp a "message us on WhatsApp" link points back at the same chat.
    const wa = ans.whatsapp && !whatsapp ? waUrl(store.tenant, waText(product, c.language)) : null;
    answer = answerText(ans.intent, product, store, c.language, wa, city);
  }
  if (answer && product && c && product.variants.length && !inStockOf(product).length) {
    const alt = await alternativeProduct(store.id, product.id);
    if (alt) answer = `${answer}\n\n${alternativeLine(alt, c.language)}`;
  }
  // Smart replies: where the fixed answers cannot (a question they do not cover, a haggle, a message with no
  // product yet) the assistant answers in the owner's words, within the guards. An order being collected keeps
  // its own step-by-step answers.
  let actions = decision.actions;
  let smartFlag: string | null | undefined;
  // A sender who already got many answers this hour (a bot on the other side, a flood) is left to the fixed rules.
  const recentAnswers = store.aiReplies && text
    ? await db.outboxJob.count({ where: { storeId: store.id, recipientId: senderId, kind: { in: ["DM_ANSWER", "PRIVATE_REPLY"] }, createdAt: { gt: new Date(now.getTime() - 3_600_000) } } })
    : 0;
  if (store.aiReplies && recentAnswers < 8 && text && c && c.confidence >= MIN_CONFIDENCE && SMART_TYPES.includes(c.type) && !(ordering && orderId && answer)) {
    const link = !whatsapp && product ? waUrl(store.tenant, waText(product, c.language)) : null;
    // A voice note reaches here as its transcript ("[audio] <words>" is what is stored): speech recognition can mishear.
    const viaVoice = (msg.content ?? "").trimStart().startsWith("[audio]");
    // A one-word message is no guide to the language: the buyer's earlier messages are.
    const smartLang = text.length < 12 ? await buyerLang(store.id, senderId) : c.language;
    const s = await smartTry({ store, kind: "dm_followup", lang: smartLang, message: text, product, waLink: link, senderId, messageId: msg.id, viaVoice });
    if (s) {
      answer = s.text;
      // "unclear" is the dashboard's pile for messages the assistant could not make sense of: the buyer got a
      // polite request to say it again, and the owner can listen to the voice note on the platform.
      smartFlag = s.unclear ? "unclear" : s.needsOwner ? "needs_you" : null;
      if (!actions.some((a) => a.kind === "DM_ANSWER")) actions = [...actions, { kind: "DM_ANSWER", intent: c.intent, whatsapp: false }];
    }
  }
  const specs = buildDmJobs({ actions, recipientId: senderId, photos: product?.photos ?? [], answerText: answer });
  let flag = smartFlag !== undefined ? smartFlag : decision.flag ?? (ans && !answer ? "needs_you" : null);
  if (!c && text && flag === "unclear") flag = await unlabelledReason(store);
  const ids = await createJobs(store.id, msg.id, specs, product?.id ?? null);
  // Answered a question but no order yet: one nudge in 20 h, cancelled if the buyer writes or orders first.
  if (answer && product && c?.type === "QUESTION" && !(await db.order.count({ where: { storeId: store.id, buyerKey: senderId, status: { in: ["NEW", "CONFIRMED"] } } }))) {
    await db.outboxJob.create({
      data: { storeId: store.id, messageId: msg.id, kind: "DM_FOLLOWUP", payload: { recipientId: senderId, message: { text: followupText(product.name, c.language) } }, recipientId: senderId, nextAttemptAt: new Date(now.getTime() + FOLLOWUP_MS) },
    }).catch((e: { code?: string }) => { if (e.code !== "P2002") throw e; });
  }
  await finish(msg.id, specs.length ? "AUTO_REPLIED" : "FLAGGED", flag, {
    commentType: c?.type ?? null, intent: c?.intent ?? null, language: c?.language ?? null, confidence: c?.confidence ?? null, boundProductId: product?.id ?? null,
  });
  return ids;
}

const COLLECT_SELECT = {
  id: true, productId: true, customerName: true, phone: true, city: true, address: true, productName: true,
  variantLabel: true, amountMinor: true, currency: true, collect: true,
} as const;
type CollectRow = CollectOrder & { id: string; productId: string | null };

const inStockOf = (p: CardProduct | null) => (p?.variants ?? []).filter((v) => v.inStock);

/** This buyer's order whose details the bot is still collecting, from the last day. */
function collectingOrder(storeId: string, buyerKey: string, now: Date): Promise<CollectRow | null> {
  return db.order.findFirst({
    where: { storeId, buyerKey, status: "NEW", collect: { in: ["ask", "confirm"] }, updatedAt: { gt: new Date(now.getTime() - DAY) } },
    orderBy: { updatedAt: "desc" },
    select: COLLECT_SELECT,
  });
}

/**
 * An order opened from this buyer's comment that we answered with a private reply in the last
 * day: its details are collected in the chat. The comment author id differs from the chat id,
 * so the order moves to the chat's buyer key.
 */
async function commentOrder(storeId: string, senderId: string, now: Date): Promise<CollectRow | null> {
  const priv = await db.outboxJob.findFirst({
    where: { storeId, kind: "PRIVATE_REPLY", status: "SENT", recipientId: senderId, updatedAt: { gt: new Date(now.getTime() - DAY) } },
    orderBy: { updatedAt: "desc" },
    select: { messageId: true },
  });
  if (!priv) return null;
  const o = await db.order.findFirst({ where: { storeId, sourceMessageId: priv.messageId, status: "NEW", collect: null }, select: COLLECT_SELECT });
  if (!o) return null;
  await db.order.update({ where: { id: o.id }, data: { buyerKey: senderId } });
  return o;
}

/** The language this buyer last wrote in. */
async function buyerLang(storeId: string, authorId: string): Promise<Lang> {
  const m = await db.conversationMessage.findFirst({ where: { storeId, authorId, language: { not: null } }, orderBy: { createdAt: "desc" }, select: { language: true } });
  return (m?.language as Lang | null) ?? "ckb";
}

/** Saves what the buyer gave and returns the next message: a question, the summary, or the thank-you. */
async function collectStep(store: Store, order: CollectRow, d: Details, text: string, lang: Lang, handle: string | null, inStock: ReturnType<typeof inStockOf>): Promise<string> {
  const { order: next, reply } = nextStep(order, d, text, { handle, inStock, store, lang });
  await db.order.update({
    where: { id: order.id },
    data: {
      customerName: next.customerName, phone: next.phone, city: next.city, address: next.address,
      variantLabel: next.variantLabel, amountMinor: next.amountMinor, currency: next.currency,
      deliveryFeeMinor: feeFor(store, next.city), collect: next.collect,
    },
  });
  return reply;
}
