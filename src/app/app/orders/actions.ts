"use server";

import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { currentWorkspace } from "@/app/app/data";
import { normalizePhone } from "@/lib/merchant/phone";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";
import { isCityCode } from "@/lib/orders/cities";
import { parsePrice, toWesternDigits } from "@/lib/shop/forms";
import type { ActionResult } from "../automation/actions";

const CURRENCIES = ["IQD", "USD"] as const;
const STATUSES = ["NEW", "CONFIRMED", "SENT", "DELIVERED", "RETURNED", "CANCELLED"] as const;
type Status = (typeof STATUSES)[number];

const isStatus = (s: string): s is Status => (STATUSES as readonly string[]).includes(s);
const clip = (s: string, max: number) => Array.from((s ?? "").trim()).slice(0, max).join("");

export interface OrderInput {
  customerName: string;
  phone: string;
  city: string;
  address: string;
  productId: string;
  variantLabel: string;
  price: string;
  currency: string;
  deliveryFee: string;
  cod: boolean;
  status: string;
  note: string;
}

/** The signed-in workspace, and only for roles that may handle customers. The tenant always comes from the session, never from the browser. */
async function engagedWorkspace() {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { error: t.actions.common.signIn } as const;
  if (!can(ws.role, "engage")) return { error: t.nr.team.roles.notAllowed } as const;
  return { ws, m: { ...t.actions.common, ...t.actions.orders } } as const;
}

const done = (id?: string): ActionResult => {
  revalidatePath("/app/orders");
  return { ok: true, id };
};

/** Creates (id null) or edits one of this workspace's orders. Where an order came from (source) never changes. */
export async function saveOrderAction(id: string | null, input: OrderInput): Promise<ActionResult> {
  const r = await engagedWorkspace();
  if (r.error !== undefined) return { ok: false, error: r.error };
  const { ws, m } = r;

  const customerName = clip(input.customerName, 80);
  if (!customerName) return { ok: false, error: m.customerName };

  let phone: string | null = null;
  if (input.phone?.trim()) {
    const p = normalizePhone(input.phone);
    if (!p.ok) return { ok: false, error: m.badPhone };
    phone = p.digits;
  }

  const city = input.city?.trim() || null;
  if (city && !isCityCode(city)) return { ok: false, error: m.badCity };

  const status = input.status || "NEW";
  if (!isStatus(status)) return { ok: false, error: m.badStatus };

  const currency = CURRENCIES.includes(input.currency as (typeof CURRENCIES)[number]) ? input.currency : "IQD";
  const priceRaw = toWesternDigits(input.price ?? "").trim();
  const amountMinor = !priceRaw || /^0+$/.test(priceRaw) ? 0 : parsePrice(priceRaw, currency);
  if (amountMinor == null) return { ok: false, error: m.badPrice };
  const feeRaw = toWesternDigits(input.deliveryFee ?? "").trim();
  const deliveryFeeMinor = !feeRaw ? null : /^0+$/.test(feeRaw) ? 0 : parsePrice(feeRaw, currency);
  if (feeRaw && deliveryFeeMinor == null) return { ok: false, error: m.badDeliveryFee };

  // A product must be one of this workspace's own, whichever store it sits in.
  let product: { id: string; name: string; storeId: string } | null = null;
  if (input.productId) {
    product = await db.product.findFirst({ where: { id: input.productId, store: { tenantId: ws.id } }, select: { id: true, name: true, storeId: true } });
    if (!product) return { ok: false, error: m.productNotFound };
  }

  const data = {
    customerName,
    phone,
    city,
    address: clip(input.address, 300) || null,
    productId: product?.id ?? null,
    productName: product?.name ?? "",
    variantLabel: clip(input.variantLabel, 40),
    amountMinor,
    currency,
    deliveryFeeMinor,
    cod: !!input.cod,
    status,
    note: clip(input.note, 500) || null,
  } satisfies Prisma.OrderUncheckedUpdateInput;

  if (id) {
    const owned = await db.order.findFirst({ where: { id, tenantId: ws.id }, select: { id: true } });
    if (!owned) return { ok: false, error: m.notFound };
    await db.order.update({ where: { id }, data: product ? { ...data, storeId: product.storeId } : data });
    return done(id);
  }
  const created = await db.order.create({ data: { ...data, tenantId: ws.id, storeId: product?.storeId ?? null, source: "MANUAL" }, select: { id: true } });
  return done(created.id);
}

export async function setOrderStatusAction(id: string, status: string): Promise<ActionResult> {
  const r = await engagedWorkspace();
  if (r.error !== undefined) return { ok: false, error: r.error };
  if (!isStatus(status)) return { ok: false, error: r.m.badStatus };
  const { count } = await db.order.updateMany({ where: { id, tenantId: r.ws.id }, data: { status } });
  if (!count) return { ok: false, error: r.m.notFound };
  return done(id);
}
