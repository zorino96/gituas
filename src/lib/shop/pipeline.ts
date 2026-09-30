import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { classifyText } from "./classify";
import { answerText, COPY, DEFAULT_SAMPLES, dmText, fbCardElements, waText, type CardProduct } from "./compose";
import { gate, gateDm } from "./gate";
import { buildCommentJobs, buildDmJobs, type JobSpec } from "./jobs";
import { accountFor, fetchPostCreatedAt, type MetaPlatform } from "./meta-client";
import type { Lang } from "./money";
import { dailyCap, SHOP_LIMITS, type StorePlan } from "./plans";
import { decideComment, decideDm, limitDecision } from "./policy";
import { runJob } from "./outbox";
import { aiVaryUsed, countAiVary } from "./quota";
import { varySample } from "./vary";

const DAY = 86_400_000;
/** Meta allows a private reply only within 7 days of the comment. */
const PRIVATE_REPLY_WINDOW = 7 * DAY;

export function jitterMs(rand: () => number = Math.random): number {
  return 8_000 + Math.floor(rand() * 22_000);
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
  if (!msg?.store || msg.outcome) return;
  const jobIds = msg.channelType === "DM" ? await planDm(msg as Msg) : await planComment(msg as Msg);
  if (!jobIds.length) return;
  if (opts.delay) await sleep(jitterMs());
  for (const id of jobIds) await runJob(id, { immediate: true });
}

async function finish(id: string, outcome: "AUTO_REPLIED" | "FLAGGED" | "SKIPPED", reason: string | null, extra: Prisma.ConversationMessageUpdateInput = {}): Promise<void> {
  await db.conversationMessage.update({ where: { id }, data: { outcome, outcomeReason: reason, ...extra } });
}

function sentToday(storeId: string, now: Date): Promise<number> {
  return db.outboxJob.count({
    where: { storeId, status: "SENT", kind: { in: ["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"] }, updatedAt: { gte: startOfUtcDay(now) } },
  });
}

async function loadProduct(id: string | null): Promise<(CardProduct & { id: string }) | null> {
  if (!id) return null;
  const p = await db.product.findUnique({ where: { id }, include: { variants: { orderBy: { position: "asc" } } } });
  if (!p?.active) return null;
  return { id: p.id, name: p.name, photos: p.photos, variants: p.variants.map((v) => ({ label: v.label, amountMinor: v.amountMinor, currency: v.currency, inStock: v.inStock })) };
}

function waUrl(tenant: Store["tenant"], text: string): string | null {
  return tenant.whatsappNumber ? `${SHOP_ORIGIN}/w/${tenant.slug}?t=${encodeURIComponent(text)}` : null;
}

async function vary(store: Store, sample: string, lang: Lang): Promise<string> {
  if ((await aiVaryUsed(store.id)) >= SHOP_LIMITS[store.plan as StorePlan].aiVaryPerMonth) return sample;
  const r = await varySample(sample, lang);
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
    const job = await db.outboxJob.upsert({
      where: { messageId_kind: { messageId, kind: s.kind } },
      create: { storeId, messageId, kind: s.kind, payload: s.payload as Prisma.InputJsonValue, recipientId: s.recipientId ?? null, nextAttemptAt },
      update: {},
      select: { id: true },
    });
    ids.push(job.id);
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
  const c = await classifyText(msg.content ?? "", { channel: "comment", productName: product?.name });
  if (!c) {
    await finish(msg.id, "FLAGGED", "unclear");
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

  let publicText: string | null = null;
  const pub = decision.actions.find((a) => a.kind === "PUBLIC_REPLY");
  if (pub?.kind === "PUBLIC_REPLY") {
    const own = pub.style === "answer" ? template?.publicSamples : template?.thanksSamples;
    const samples = own?.length ? own : DEFAULT_SAMPLES[pub.style][c.language];
    publicText = await vary(store, pickOne(samples), c.language);
  }

  let card: { text: string; elements: ReturnType<typeof fbCardElements> } | null = null;
  const priv = decision.actions.find((a) => a.kind === "PRIVATE_REPLY");
  if (priv?.kind === "PRIVATE_REPLY" && priv.content === "card" && product) {
    const wa = priv.whatsapp ? waUrl(store.tenant, waText(product, c.language)) : null;
    const greeting = template?.dmGreeting === false ? COPY[c.language].hello : await vary(store, COPY[c.language].hello, c.language);
    card = { text: dmText({ greeting, product, store, lang: c.language, waUrl: wa }), elements: fbCardElements(product, store, c.language, wa) };
  }

  const specs = buildCommentJobs({ decision, platform, commentId, authorName: msg.authorHandle, publicText, card, defaultDm: store.defaultDm });
  const ids = await createJobs(store.id, msg.id, specs);
  if (limited && !decision.flag && !specs.length) {
    await finish(msg.id, "SKIPPED", "author_limit", { commentType: c.type, intent: c.intent, language: c.language, confidence: c.confidence });
    return [];
  }
  const replied = specs.some((s) => s.kind === "PUBLIC_REPLY" || s.kind === "PRIVATE_REPLY");
  await finish(msg.id, replied ? "AUTO_REPLIED" : "FLAGGED", decision.flag ?? (replied ? null : "no_action"), {
    commentType: c.type, intent: c.intent, language: c.language, confidence: c.confidence, boundProductId: product?.id ?? null,
  });
  return ids;
}

async function planDm(msg: Msg): Promise<string[]> {
  const store = msg.store;
  const now = new Date();
  const platform = msg.platform as MetaPlatform;
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

  // The thread is about the product whose card we sent this buyer in the last 7 days.
  const bound = await db.outboxJob.findFirst({
    where: { storeId: store.id, kind: "PRIVATE_REPLY", status: "SENT", recipientId: senderId, updatedAt: { gt: new Date(now.getTime() - PRIVATE_REPLY_WINDOW) } },
    orderBy: { updatedAt: "desc" },
    select: { message: { select: { boundProductId: true } } },
  });
  const product = await loadProduct(bound?.message.boundProductId ?? null);
  const photosSent = product ? await db.outboxJob.count({ where: { id: `dmphotos_${store.id}_${senderId}_${product.id}` } }) : 0;
  const text = (msg.content ?? "").trim();
  const c = text ? await classifyText(text, { channel: "dm", productName: product?.name }) : null;
  const decision = decideDm(c, { boundProduct: !!product, firstReply: photosSent === 0, hasPhotos: (product?.photos.length ?? 0) > 0 });

  let answer: string | null = null;
  const ans = decision.actions.find((a) => a.kind === "DM_ANSWER");
  if (ans?.kind === "DM_ANSWER" && product && c) {
    const wa = ans.whatsapp ? waUrl(store.tenant, waText(product, c.language)) : null;
    answer = answerText(ans.intent, product, store, c.language, wa);
  }
  const specs = buildDmJobs({ actions: decision.actions, recipientId: senderId, photos: product?.photos ?? [], answerText: answer });
  const flag = decision.flag ?? (ans && !answer ? "needs_you" : null);
  const ids = await createJobs(store.id, msg.id, specs, product?.id ?? null);
  await finish(msg.id, specs.length ? "AUTO_REPLIED" : "FLAGGED", flag, {
    commentType: c?.type ?? null, intent: c?.intent ?? null, language: c?.language ?? null, confidence: c?.confidence ?? null, boundProductId: product?.id ?? null,
  });
  return ids;
}
