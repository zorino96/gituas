"use server";

import { headers } from "next/headers";

import { currentWorkspace } from "@/app/app/data";
import { startCheckout, type CheckoutResult } from "@/lib/billing/invoices";
import { isAppOrigin, NEWSROOM_ORIGIN, SHOP_ORIGIN } from "@/lib/hosts";
import { dict, getLang } from "@/lib/i18n";
import { can } from "@/lib/newsroom/roles";

/** Return the buyer to the domain they are on, when it is one of ours. */
async function origin(fallback: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const o = host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : fallback;
  return isAppOrigin(o) ? o : fallback;
}

export async function startShopCheckoutAction(storeId: string, plan: string): Promise<CheckoutResult> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (!can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };
  return startCheckout({ tenantId: ws.id, product: "SHOP", plan, storeId, origin: await origin(SHOP_ORIGIN), returnPath: "/app/billing" });
}

export async function startNewsCheckoutAction(plan: string): Promise<CheckoutResult> {
  const [ws, t] = await Promise.all([currentWorkspace(), getLang().then(dict)]);
  if (!ws) return { ok: false, error: t.actions.common.signIn };
  if (ws.kind !== "NEWS" || !can(ws.role, "configure")) return { ok: false, error: t.nr.team.roles.notAllowed };
  return startCheckout({ tenantId: ws.id, product: "NEWS", plan, storeId: null, origin: await origin(NEWSROOM_ORIGIN), returnPath: "/newsroom/billing" });
}
