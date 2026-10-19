// Shop autopilot: in each store's posting hours it picks a product, writes a caption and
// either prepares the post (DRAFT) or posts it to the store's Facebook Page and Instagram
// (PUBLISH, paid plans). TikTok and YouTube are never posted here: the prepared post opens
// in Publish for the merchant's one tap. Prices come from the product, never from the AI.

import { aiFor, type AiOptions } from "@/lib/ai/for-store";
import type { Prisma } from "@/generated/prisma/client";
import { completeJson } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { isJpegPath, isOwnBlobUrl } from "@/lib/merchant/caption";
import { publishForWorkspace, type PublishInput } from "@/lib/merchant/publish-core";
import { loadAutopilotSignals } from "@/lib/orders/audience";
import { effectiveMode, isDue, pickProduct, SLOT_GUARD_MS, slotHours } from "./autopilot-plan";
import { cityHashtags } from "@/lib/orders/hashtags";
import { formatMoney } from "./money";
import { hasLinkOrPhone, loadProfile, profileLines, type Profile } from "./profile";
import { numbersIn } from "./smart";

/**
 * Stores posted per tick; the cron route has 60 seconds in all and one post can take ~40.
 * ponytail: 1 per 5-minute tick = 12 stores per slot hour; move to its own route or a queue past that.
 */
const PER_TICK = 1;
const IG_DEADLINE_MS = 20_000;

export interface AutoDraft {
  productId: string;
  caption: string;
  media: { url: string; pathname: string; type: "IMAGE" };
  at: string;
}

async function writeCaption(name: string, description: string | null, ai?: AiOptions, biz?: Profile | null): Promise<string> {
  const about = profileLines(biz ?? null, { lang: biz?.language ?? "ckb", audience: "caption" });
  const language = biz?.language === "ar" ? "Arabic (Iraqi, Arabic script)" : "Sorani Kurdish (Arabic script)";
  // The call at the end follows what the owner wants from their page.
  const ending = biz?.goal === "grow" || biz?.goal === "monetize" ? "End with a call to follow the page." : "End with a call to message the page.";
  try {
    const { data } = await completeJson<{ text: string }>(
      {
        system: 'You write short social media texts for shops in Iraqi Kurdistan. Reply with JSON only: {"text": "<the text>"}',
        user: `Write a ${language} caption for this product.
Product: """${name.slice(0, 120)}"""
${description ? `About it: """${description.slice(0, 600)}"""` : ""}
${about.length ? `About the business (confirmed by the owner):\n${about.join("\n")}\n` : ""}Rules:
- 2 to 3 short lines, a curiosity hook first.
- No price, size, quantity or delivery fee: the price is added separately.
- ${ending} No hashtags. At most two emoji.`,
        strength: "fast",
        tier: "haiku",
        meter: ai?.meter,
        maxTokens: 400,
        budgetMs: 15_000,
      },
      (d) => (typeof (d as { text?: unknown })?.text === "string" ? (d as { text: string }) : null),
    );
    const text = data.text.trim();
    // With a profile the caption is public and goes out with no review: no link, handle or phone, and no number the product does not have.
    const allowed = new Set(numbersIn(`${name} ${description ?? ""}`));
    const clean = !biz || (!hasLinkOrPhone(text) && numbersIn(text).every((n) => allowed.has(n)));
    if (text && clean) return text;
  } catch (e) {
    console.error("[shop-autopilot] caption failed:", e instanceof Error ? e.message : "unknown error");
  }
  return [name, description?.trim()].filter(Boolean).join("\n");
}

function priceLine(variants: { amountMinor: number; currency: string; inStock: boolean }[], lang: "ckb" | "ar" = "ckb"): string {
  const live = variants.filter((v) => v.inStock && v.amountMinor > 0);
  if (!live.length) return "";
  const low = live.reduce((a, b) => (b.amountMinor < a.amountMinor ? b : a));
  const from = live.some((v) => v.currency === low.currency && v.amountMinor !== low.amountMinor);
  return `💰 ${from ? (lang === "ar" ? "من " : "لە ") : ""}${formatMoney(low.amountMinor, low.currency, lang)}`;
}

async function runStore(store: {
  id: string;
  tenantId: string;
  plan: string;
  autoMode: string;
  autoPerDay: number;
  autoLastAt: Date | null;
  fbPageId: string | null;
  igUserId: string | null;
}, now: number): Promise<"skipped" | "drafted" | "published" | "failed"> {
  const mode = effectiveMode(store.autoMode, store.plan);
  if (mode === "OFF") return "skipped";
  // Posted within the last slot: nothing to read yet. (This runs every minute for every store.)
  if (store.autoLastAt && now - store.autoLastAt.getTime() < SLOT_GUARD_MS) return "skipped";
  const profile = await loadAutopilotSignals(store.tenantId);
  if (!isDue(store.autoLastAt, slotHours(profile.hours, store.autoPerDay), now)) return "skipped";

  // Claim the slot first, so an overlapping tick never posts the same slot twice.
  const claim = await db.store.updateMany({
    where: { id: store.id, autoLastAt: store.autoLastAt },
    data: { autoLastAt: new Date(now) },
  });
  if (claim.count !== 1) return "skipped";

  const products = await db.product.findMany({
    where: { storeId: store.id, active: true },
    select: { id: true, name: true, description: true, photos: true, autoPostedAt: true, variants: { select: { amountMinor: true, currency: true, inStock: true } } },
  });
  const usable = products.map((p) => ({
    ...p,
    photos: p.photos.filter((u) => isOwnBlobUrl(u, store.tenantId) && isJpegPath(new URL(u).pathname)),
    inStock: p.variants.length === 0 || p.variants.some((v) => v.inStock),
  }));
  const product = pickProduct(usable, profile.products, now);
  if (!product) return "skipped";
  const full = usable.find((p) => p.id === product.id)!;

  const url = full.photos[0];
  // Hashtags of the cities its buyers come from, in both scripts: how Kurdish shoppers find sellers.
  const tags = cityHashtags(profile.cities).join(" ");
  const biz = await loadProfile(store.id);
  const caption = [await writeCaption(full.name, full.description, aiFor(store), biz), priceLine(full.variants, biz?.language === "ar" ? "ar" : "ckb"), tags].filter(Boolean).join("\n\n");
  const draft: AutoDraft = { productId: full.id, caption, media: { url, pathname: new URL(url).pathname.slice(1), type: "IMAGE" }, at: new Date(now).toISOString() };
  await db.product.update({ where: { id: full.id }, data: { autoPostedAt: new Date(now) } });
  await db.store.update({ where: { id: store.id }, data: { autoDraft: draft as unknown as Prisma.InputJsonValue } });
  if (mode === "DRAFT") return "drafted";

  const targets = [store.fbPageId ? "FB" : null, store.igUserId ? "IG" : null].filter((x): x is "FB" | "IG" => !!x);
  if (!targets.length) return "drafted";
  const input: PublishInput = {
    caption,
    targets,
    media: draft.media,
    productId: full.id,
    igDeadlineMs: IG_DEADLINE_MS,
    accounts: { ...(store.fbPageId ? { FB: [store.fbPageId] } : {}), ...(store.igUserId ? { IG: [store.igUserId] } : {}) },
  };
  const r = await publishForWorkspace({ id: store.tenantId, kind: "MERCHANT", role: "OWNER" }, input);
  const ok = Array.isArray(r) && r.some((o) => o.ok || o.pending);
  await db.auditLog.create({
    data: {
      tenantId: store.tenantId,
      actor: "SYSTEM",
      action: ok ? "shop.autopilot_publish" : "shop.autopilot_failed",
      reasoning: ok ? `Autopilot posted "${full.name}".` : `Autopilot could not post "${full.name}".`,
      metadata: { productId: full.id, result: (Array.isArray(r) ? r : [r]) as unknown as Prisma.InputJsonValue },
    },
  });
  return ok ? "published" : "failed";
}

/** One tick for every store with the autopilot on. Never throws; one failing store does not stop the rest. */
export async function runShopAutopilot(now = Date.now()): Promise<Record<string, number>> {
  const stores = await db.store.findMany({
    where: { autoMode: { in: ["DRAFT", "PUBLISH"] }, pausedReason: null },
    orderBy: { autoLastAt: { sort: "asc", nulls: "first" } },
    select: { id: true, tenantId: true, plan: true, autoMode: true, autoPerDay: true, autoLastAt: true, fbPageId: true, igUserId: true },
    take: 50,
  });
  const counts: Record<string, number> = {};
  let worked = 0;
  for (const s of stores) {
    if (worked >= PER_TICK) break;
    const r = await runStore(s, now).catch((e) => {
      console.error("[shop-autopilot] store failed:", e instanceof Error ? e.message : "unknown error");
      return "failed" as const;
    });
    counts[r] = (counts[r] ?? 0) + 1;
    if (r !== "skipped") worked++;
  }
  return counts;
}
