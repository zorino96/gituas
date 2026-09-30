"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";
import { cleanSamples, parsePrice } from "@/lib/shop/forms";
import { currentWorkspace } from "@/app/app/data";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const DAY = 86_400_000;
const CURRENCIES = ["IQD", "USD"] as const;

/** The signed-in workspace's own store, and only for roles that may configure. */
async function ownedStore(storeId: string) {
  const ws = await currentWorkspace();
  if (!ws) return { error: "چوونەژوورەوە پێویستە." } as const;
  if (!can(ws.role, "configure")) return { error: NOT_ALLOWED } as const;
  const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true, tenantId: true, expiryDays: true, defaultTemplateId: true } });
  if (!store) return { error: "دووکانەکە نەدۆزرایەوە." } as const;
  return { ws, store } as const;
}

const done = (id?: string): ActionResult => {
  revalidatePath("/app/automation");
  revalidatePath("/app/products");
  return { ok: true, id };
};

export async function saveStoreSettingsAction(
  storeId: string,
  input: { automationEnabled: boolean; expiryDays: number; stopBefore: string; likeComments: boolean; autoHideSpam: boolean; deliveryFee: string; deliveryTime: string; defaultDm: string },
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const days = Math.round(Number(input.expiryDays));
  if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, error: "ڕۆژەکان دەبێت لە ١ تا ٣٦٥ بن." };
  let stopBefore: Date | null = null;
  if (input.stopBefore.trim()) {
    stopBefore = new Date(`${input.stopBefore.trim()}T00:00:00Z`);
    if (Number.isNaN(stopBefore.getTime())) return { ok: false, error: "ڕێکەوتەکە دروست نییە." };
  }
  let deliveryFeeMinor: number | null = null;
  if (input.deliveryFee.trim()) {
    deliveryFeeMinor = input.deliveryFee.trim() === "0" ? 0 : parsePrice(input.deliveryFee, "IQD");
    if (deliveryFeeMinor == null) return { ok: false, error: "کرێی گەیاندن دروست نییە." };
  }
  await db.store.update({
    where: { id: r.store.id },
    data: {
      automationEnabled: !!input.automationEnabled,
      expiryDays: days,
      stopBefore,
      likeComments: !!input.likeComments,
      autoHideSpam: !!input.autoHideSpam,
      deliveryFeeMinor,
      deliveryCurrency: "IQD",
      deliveryTime: Array.from(input.deliveryTime.trim()).slice(0, 60).join("") || null,
      defaultDm: Array.from(input.defaultDm.trim()).slice(0, 1000).join("") || null,
    },
  });
  return done();
}

export async function saveTemplateAction(
  storeId: string,
  templateId: string | null,
  input: { name: string; publicSamples: string[]; thanksSamples: string[]; dmGreeting: boolean; whatsappAlways: boolean; makeDefault: boolean },
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const name = Array.from(input.name.trim()).slice(0, 40).join("");
  if (!name) return { ok: false, error: "ناوێک بۆ تێمپلەیتەکە بنووسە." };
  const data = { name, publicSamples: cleanSamples(input.publicSamples), thanksSamples: cleanSamples(input.thanksSamples), dmGreeting: !!input.dmGreeting, whatsappAlways: !!input.whatsappAlways };
  let id = templateId;
  if (id) {
    const owned = await db.automationTemplate.findFirst({ where: { id, storeId: r.store.id }, select: { id: true } });
    if (!owned) return { ok: false, error: "تێمپلەیتەکە نەدۆزرایەوە." };
    await db.automationTemplate.update({ where: { id }, data });
  } else {
    id = (await db.automationTemplate.create({ data: { storeId: r.store.id, ...data }, select: { id: true } })).id;
  }
  if (input.makeDefault || !r.store.defaultTemplateId) await db.store.update({ where: { id: r.store.id }, data: { defaultTemplateId: id } });
  return done(id);
}

export async function deleteTemplateAction(storeId: string, templateId: string): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const owned = await db.automationTemplate.findFirst({ where: { id: templateId, storeId: r.store.id }, select: { id: true } });
  if (!owned) return { ok: false, error: "تێمپلەیتەکە نەدۆزرایەوە." };
  await db.$transaction([
    db.postAutomation.updateMany({ where: { storeId: r.store.id, templateId }, data: { templateId: null } }),
    db.store.updateMany({ where: { id: r.store.id, defaultTemplateId: templateId }, data: { defaultTemplateId: null } }),
    db.automationTemplate.delete({ where: { id: templateId } }),
  ]);
  return done();
}

export async function setPostAutomationAction(
  storeId: string,
  input: { platform: "FB" | "IG"; postId: string; postCreatedAt: string | null; enabled?: boolean; productId?: string | null; templateId?: string | null },
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (!/^[\w-]{1,100}$/.test(input.postId)) return { ok: false, error: "پۆستەکە دروست نییە." };
  if (input.productId && !(await db.product.findFirst({ where: { id: input.productId, storeId: r.store.id, active: true }, select: { id: true } }))) {
    return { ok: false, error: "بەرهەمەکە نەدۆزرایەوە." };
  }
  if (input.templateId && !(await db.automationTemplate.findFirst({ where: { id: input.templateId, storeId: r.store.id }, select: { id: true } }))) {
    return { ok: false, error: "تێمپلەیتەکە نەدۆزرایەوە." };
  }
  const platform = input.platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK";
  const created = input.postCreatedAt ? new Date(input.postCreatedAt) : new Date();
  const postCreatedAt = Number.isNaN(created.getTime()) ? new Date() : created;
  const patch = {
    ...(input.enabled !== undefined ? { enabled: !!input.enabled } : {}),
    ...(input.productId !== undefined ? { productId: input.productId || null } : {}),
    ...(input.templateId !== undefined ? { templateId: input.templateId || null } : {}),
  };
  await db.postAutomation.upsert({
    where: { storeId_platform_externalPostId: { storeId: r.store.id, platform, externalPostId: input.postId } },
    create: { storeId: r.store.id, platform, externalPostId: input.postId, postCreatedAt, activeUntil: new Date(postCreatedAt.getTime() + r.store.expiryDays * DAY), ...patch },
    update: patch,
  });
  return done();
}

export async function saveProductAction(
  storeId: string,
  productId: string | null,
  input: { name: string; description: string; photos: string[]; variants: { label: string; price: string; currency: string; inStock: boolean }[] },
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const name = Array.from(input.name.trim()).slice(0, 80).join("");
  if (!name) return { ok: false, error: "ناوی بەرهەمەکە بنووسە." };
  const photos = input.photos.slice(0, 5);
  if (photos.some((u) => !u.startsWith("https://") || !u.includes(`/merchant/${r.ws.id}/`))) return { ok: false, error: "وێنەیەک دروست نییە." };
  if (!input.variants.length || input.variants.length > 20) return { ok: false, error: "لانیکەم یەک نرخ پێویستە." };
  const variants = [];
  for (const [i, v] of input.variants.entries()) {
    const currency = CURRENCIES.includes(v.currency as (typeof CURRENCIES)[number]) ? v.currency : "IQD";
    const amountMinor = parsePrice(v.price, currency);
    if (amountMinor == null) return { ok: false, error: `نرخی ڕیزی ${i + 1} دروست نییە.` };
    const label = Array.from(v.label.trim()).slice(0, 40).join("");
    if (!label && input.variants.length > 1) return { ok: false, error: `ناوی جۆری ڕیزی ${i + 1} بنووسە (قیاس یان ڕەنگ).` };
    variants.push({ label, amountMinor, currency, inStock: !!v.inStock, position: i });
  }
  const description = Array.from(input.description.trim()).slice(0, 500).join("") || null;
  let id = productId;
  if (id) {
    const owned = await db.product.findFirst({ where: { id, storeId: r.store.id }, select: { id: true } });
    if (!owned) return { ok: false, error: "بەرهەمەکە نەدۆزرایەوە." };
    await db.$transaction([
      db.product.update({ where: { id }, data: { name, description, photos, active: true } }),
      db.productVariant.deleteMany({ where: { productId: id } }),
      db.productVariant.createMany({ data: variants.map((v) => ({ ...v, productId: id! })) }),
    ]);
  } else {
    id = (await db.product.create({ data: { storeId: r.store.id, name, description, photos, variants: { create: variants } }, select: { id: true } })).id;
  }
  return done(id);
}

export async function archiveProductAction(storeId: string, productId: string): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const { count } = await db.product.updateMany({ where: { id: productId, storeId: r.store.id }, data: { active: false } });
  if (!count) return { ok: false, error: "بەرهەمەکە نەدۆزرایەوە." };
  return done();
}
