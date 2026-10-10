"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { isCityCode } from "@/lib/orders/cities";
import { isOwnBlobUrl } from "@/lib/merchant/caption";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { cleanSamples, parsePrice, toWesternDigits } from "@/lib/shop/forms";
import { accountFor, fetchPostCreatedAt } from "@/lib/shop/meta-client";
import { currentWorkspace } from "@/app/app/data";

export type ActionResult = { ok: true; id?: string } | { ok: false; error: string };

const DAY = 86_400_000;
const CURRENCIES = ["IQD", "USD"] as const;

/** The signed-in workspace's own store, and only for roles that may configure; `m` is the user's wording. */
async function ownedStore(storeId: string) {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { error: t.actions.common.signIn } as const;
  if (!can(ws.role, "configure")) return { error: t.nr.team.roles.notAllowed } as const;
  const store = await db.store.findFirst({ where: { id: storeId, tenantId: ws.id }, select: { id: true, tenantId: true, expiryDays: true, defaultTemplateId: true, fbPageId: true, igUserId: true } });
  if (!store) return { error: t.actions.automation.storeNotFound } as const;
  return { ws, store, m: { ...t.actions.common, ...t.actions.automation } } as const;
}

const done = (id?: string): ActionResult => {
  revalidatePath("/app/automation");
  revalidatePath("/app/products");
  return { ok: true, id };
};

/** Saves only the settings that are present: each screen section sends its own fields, so two quick saves cannot undo each other. */
export async function saveStoreSettingsAction(
  storeId: string,
  input: Partial<{ automationEnabled: boolean; expiryDays: number; stopBefore: string; likeComments: boolean; autoHideSpam: boolean; deliveryFee: string; deliveryTime: string; defaultDm: string; cityFees: Record<string, string> }>,
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  const data: Prisma.StoreUpdateInput = {};
  if (input.automationEnabled !== undefined) data.automationEnabled = !!input.automationEnabled;
  if (input.likeComments !== undefined) data.likeComments = !!input.likeComments;
  if (input.autoHideSpam !== undefined) data.autoHideSpam = !!input.autoHideSpam;
  if (input.expiryDays !== undefined) {
    const days = Math.round(Number(input.expiryDays));
    if (!Number.isFinite(days) || days < 1 || days > 365) return { ok: false, error: r.m.badDays };
    data.expiryDays = days;
  }
  if (input.stopBefore !== undefined) {
    const raw = input.stopBefore.trim();
    if (raw) {
      // Midnight in Baghdad, where the merchant picked the date.
      const stopBefore = new Date(`${raw}T00:00:00+03:00`);
      if (Number.isNaN(stopBefore.getTime())) return { ok: false, error: r.m.badDate };
      data.stopBefore = stopBefore;
    } else {
      data.stopBefore = null;
    }
  }
  if (input.deliveryFee !== undefined) {
    const fee = toWesternDigits(input.deliveryFee).trim();
    if (!fee) {
      data.deliveryFeeMinor = null;
    } else {
      const minor = /^0+$/.test(fee) ? 0 : parsePrice(fee, "IQD");
      if (minor == null) return { ok: false, error: r.m.badDeliveryFee };
      data.deliveryFeeMinor = minor;
    }
    data.deliveryCurrency = "IQD";
  }
  if (input.cityFees !== undefined) {
    const fees: Record<string, number> = {};
    for (const [city, raw] of Object.entries(input.cityFees ?? {})) {
      const fee = toWesternDigits(String(raw)).trim();
      if (!fee) continue;
      if (!isCityCode(city)) return { ok: false, error: r.m.badDeliveryFee };
      const minor = /^0+$/.test(fee) ? 0 : parsePrice(fee, "IQD");
      if (minor == null) return { ok: false, error: r.m.badDeliveryFee };
      fees[city] = minor;
    }
    data.deliveryCityFees = Object.keys(fees).length ? fees : Prisma.DbNull;
  }
  if (input.deliveryTime !== undefined) data.deliveryTime = Array.from(input.deliveryTime.trim()).slice(0, 60).join("") || null;
  if (input.defaultDm !== undefined) data.defaultDm = Array.from(input.defaultDm.trim()).slice(0, 1000).join("") || null;
  if (Object.keys(data).length) await db.store.update({ where: { id: r.store.id }, data });
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
  if (!name) return { ok: false, error: r.m.templateName };
  const data = { name, publicSamples: cleanSamples(input.publicSamples), thanksSamples: cleanSamples(input.thanksSamples), dmGreeting: !!input.dmGreeting, whatsappAlways: !!input.whatsappAlways };
  let id = templateId;
  if (id) {
    const owned = await db.automationTemplate.findFirst({ where: { id, storeId: r.store.id }, select: { id: true } });
    if (!owned) return { ok: false, error: r.m.templateNotFound };
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
  if (!owned) return { ok: false, error: r.m.templateNotFound };
  await db.$transaction([
    db.postAutomation.updateMany({ where: { storeId: r.store.id, templateId }, data: { templateId: null } }),
    db.store.updateMany({ where: { id: r.store.id, defaultTemplateId: templateId }, data: { defaultTemplateId: null } }),
    db.automationTemplate.delete({ where: { id: templateId } }),
  ]);
  return done();
}

export async function setPostAutomationAction(
  storeId: string,
  input: { platform: "FB" | "IG"; postId: string; enabled?: boolean; productId?: string | null; templateId?: string | null },
): Promise<ActionResult> {
  const r = await ownedStore(storeId);
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (!/^[\w-]{1,100}$/.test(input.postId)) return { ok: false, error: r.m.badPost };
  if (input.productId && !(await db.product.findFirst({ where: { id: input.productId, storeId: r.store.id, active: true }, select: { id: true } }))) {
    return { ok: false, error: r.m.productNotFound };
  }
  if (input.templateId && !(await db.automationTemplate.findFirst({ where: { id: input.templateId, storeId: r.store.id }, select: { id: true } }))) {
    return { ok: false, error: r.m.templateNotFound };
  }
  const platform = input.platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK";
  const patch = {
    ...(input.enabled !== undefined ? { enabled: !!input.enabled } : {}),
    ...(input.productId !== undefined ? { productId: input.productId || null } : {}),
    ...(input.templateId !== undefined ? { templateId: input.templateId || null } : {}),
  };
  const key = { storeId_platform_externalPostId: { storeId: r.store.id, platform, externalPostId: input.postId } } as const;
  const found = await db.postAutomation.findUnique({ where: key, select: { id: true } });
  if (found) {
    await db.postAutomation.update({ where: key, data: patch });
  } else {
    // The post's age comes from Meta, never from the browser; the clock is only the fallback.
    const acc = await accountFor(r.store, platform);
    const created = (acc && (await fetchPostCreatedAt(acc, input.postId))) ?? new Date();
    await db.postAutomation.create({
      data: { storeId: r.store.id, platform, externalPostId: input.postId, postCreatedAt: created, activeUntil: new Date(created.getTime() + r.store.expiryDays * DAY), ...patch },
    });
  }
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
  if (!name) return { ok: false, error: r.m.productName };
  const photos = input.photos.slice(0, 5);
  if (!photos.every((u) => isOwnBlobUrl(u, r.ws.id))) return { ok: false, error: r.m.badPhoto };
  if (!input.variants.length || input.variants.length > 20) return { ok: false, error: r.m.needPrice };
  const variants = [];
  for (const [i, v] of input.variants.entries()) {
    const currency = CURRENCIES.includes(v.currency as (typeof CURRENCIES)[number]) ? v.currency : "IQD";
    const amountMinor = parsePrice(v.price, currency);
    if (amountMinor == null) return { ok: false, error: r.m.badRowPrice(i + 1) };
    const label = Array.from(v.label.trim()).slice(0, 40).join("");
    if (!label && input.variants.length > 1) return { ok: false, error: r.m.rowLabel(i + 1) };
    variants.push({ label, amountMinor, currency, inStock: !!v.inStock, position: i });
  }
  const description = Array.from(input.description.trim()).slice(0, 500).join("") || null;
  let id = productId;
  if (id) {
    const owned = await db.product.findFirst({ where: { id, storeId: r.store.id }, select: { id: true } });
    if (!owned) return { ok: false, error: r.m.productNotFound };
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
  if (!count) return { ok: false, error: r.m.productNotFound };
  return done();
}
