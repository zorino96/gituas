// Read-backs of "start again from nothing": the accounts that were to be disconnected are gone from the stored credentials, and no
// product is left on the Products screen. Read-only, scoped by the workspace, one query each; a check that cannot tell says nothing.

import { db } from "@/lib/db";
import { say, words } from "../tools/writes-common";
import type { VerifyFn } from "../types";

const GONE = say(
  (n: number) => `${n} ئەکاونت چیتر نەبەستراون.`,
  (n: number) => `${n} من الحسابات لم تعد مربوطة.`,
  (n: number) => `${n} ${n === 1 ? "account is" : "accounts are"} no longer connected.`,
);
const STILL = say(
  (n: number) => `${n} ئەکاونت هێشتا بەستراون.`,
  (n: number) => `ما زال ${n} من الحسابات مربوطاً.`,
  (n: number) => `${n} ${n === 1 ? "account is" : "accounts are"} still connected.`,
);
const NONE_LEFT = words("هیچ بەرهەمێک لە شاشەی بەرهەمەکان نەماوە.", "لم يبق أي منتج في شاشة المنتجات.", "No product is left on the Products screen.");
const SOME_LEFT = say(
  (n: number) => `${n} بەرهەم هێشتا لە شاشەی بەرهەمەکان ماون.`,
  (n: number) => `ما زال ${n} من المنتجات في شاشة المنتجات.`,
  (n: number) => `${n} ${n === 1 ? "product is" : "products are"} still on the Products screen.`,
);

const disconnectAccounts: VerifyFn = async (ctx, args) => {
  const a = args && typeof args === "object" ? (args as { accounts?: unknown }) : {};
  const ids = Array.isArray(a.accounts) ? a.accounts.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length) return null;
  const rows = await db.oAuthCredential.findMany({
    where: { tenantId: ctx.tenantId, provider: { in: ["META_FACEBOOK", "META_INSTAGRAM", "TIKTOK", "YOUTUBE"] } },
    select: { provider: true, providerAccountId: true },
    take: 80,
  });
  const left = rows.filter((r) => ids.includes(`${r.provider}:${r.providerAccountId}`)).length;
  if (!left) return { status: "ok", checked: [GONE[ctx.lang](ids.length)], problems: [] };
  return {
    status: "problem",
    checked: [],
    problems: [STILL[ctx.lang](left)],
    fix: "Some accounts are still connected. Tell the owner, and offer to call disconnect_accounts again for the same platform (a card).",
  };
};

const removeAllProducts: VerifyFn = async (ctx) => {
  const left = await db.product.count({ where: { active: true, store: { tenantId: ctx.tenantId } } });
  if (!left) return { status: "ok", checked: [NONE_LEFT[ctx.lang]], problems: [] };
  return {
    status: "problem",
    checked: [],
    problems: [SOME_LEFT[ctx.lang](left)],
    fix: "Some products are still active. Tell the owner, and offer to call remove_all_products again (a card).",
  };
};

export const RESET_VERIFIERS: Record<string, VerifyFn> = { disconnect_accounts: disconnectAccounts, remove_all_products: removeAllProducts };
