# Billing with Wayl — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants and newsrooms pay for a plan with any Iraqi method Wayl supports (FIB, ZainCash, QiCard, FastPay, cards). The plan switches on for 30 days, renewals extend it, and a lapsed plan drops back by itself.

**Design (approved by the owner on 2026-09-30):**
- A buy button creates an `Invoice` and a Wayl payment link (`POST https://api.thewayl.com/api/v1/links`, IQD only, `env` test or live). The buyer is redirected to Wayl.
- Wayl calls `POST /api/billing/wayl`. That route, and the return page, **confirm with Wayl's own API**: `GET /api/v1/links/{referenceId}` must show `status === "Complete"` and a matching `total`. Only then is the invoice marked PAID. The webhook payload alone is never trusted; its `x-wayl-signature-256` HMAC is checked when present.
- Paying extends `planPaidUntil` by 30 days from `max(now, current)` and sets the plan.
- A daily cron drops lapsed plans and expires pending invoices older than 3 days:
  - shop stores → `FREE`;
  - newsroom workspaces that had paid → `LITE`.
- **Prices** (IQD per month):

  | Product | Plan | Price |
  |---|---|---|
  | Shop, per store/page | MERCHANT | 8,000 |
  | Shop, per store/page | PRO | 12,000 |
  | Newsroom, per workspace | LITE (new, "پەیجی بچووک") | 25,000 |
  | Newsroom, per workspace | MANUAL ("بنەڕەت") | 155,000 |
  | Newsroom, per workspace | AUTO ("پرۆ") | 390,000 |
  | Newsroom, per workspace | ENTERPRISE ("دامەزراوە") | 940,000 |

- **LITE limits:** 1 desk, 1 seat, 5 sources, 100 drafts, 10 improves, 100 publishes per month.
- **Deliberately open:** unpaid newsroom workspaces keep today's free MANUAL until a trial policy is decided. Only workspaces whose paid period lapsed are moved to LITE.
- **Wayl facts** (from its OpenAPI at `https://api.thewayl.com/openapi.v1.json`, 2026-09-30):
  - Auth header: `X-WAYL-AUTHENTICATION`.
  - Link body: `env`, `referenceId`, `total`, `currency`, `customParameter`, `lineItem[{label, amount, type:"increase"}]`, `webhookUrl`, `webhookSecret` (10-255 chars), `redirectionUrl`.
  - The response carries the link in `data.url` / `data.id` / `data.status`.
  - Statuses: Created, Pending, Processing, **Complete**.
  - The store must be verified at Wayl before links work.

**Tech Stack:**
- Next.js 16 route handlers and server actions.
- Prisma 7: schema change, applied by the owner with `prisma db push`.
- vitest; node:crypto HMAC.

**Conventions:**
- Branch `billing-wayl`. Commit per task, ending with your Co-Authored-By trailer.
- Do not push, run `prisma db push`, or write to the database.
- Git Bash, from the repo root.
- UI uses the shop's existing `gm-` classes and patterns. See `src/app/app/automation/*` and `src/app/app/settings/*`.

---

## File map

| File | Change |
|---|---|
| `prisma/schema.prisma` | Add `TenantPlan.LITE`, `InvoiceStatus` enum, `Invoice` model, `Store.planPaidUntil`, `Tenant.planPaidUntil`, back-relations |
| `src/lib/billing/plans.ts` | Add `LITE` to `Plan` and `NEWS_LIMITS` |
| `src/lib/billing/prices.ts` | New: prices, labels, `priceFor`, `extendPaidUntil` |
| `src/lib/billing/wayl.ts` | New: `createLink`, `getLink`, `signatureValid`, `waylConfigured`, `waylEnv` |
| `src/lib/billing/invoices.ts` | New: `startCheckout`, `confirmInvoice`, `expireOverdue` |
| `src/app/api/billing/wayl/route.ts` | New: the webhook |
| `src/app/api/cron/billing/route.ts` + `vercel.json` | New: daily expiry |
| `src/app/app/billing/*`, `src/app/newsroom/(desk)/billing/*` | New pages + actions |
| `src/app/app/settings/*`, `src/app/newsroom/(desk)/settings/*`, `src/app/app/automation/automation-client.tsx` | Links to billing |
| `tests/billing/*.test.ts` | Tests |

---

### Task 1: Schema and LITE limits

**Files:** `prisma/schema.prisma`, `src/lib/billing/plans.ts`.

- [ ] **Step 1: Schema.**
  - In `enum TenantPlan`, add `LITE` as the first value (keep `MANUAL`, `AUTO`, `ENTERPRISE`). The default stays `MANUAL`.
  - Append to the schema:

```prisma
enum InvoiceStatus {
  PENDING
  PAID
  EXPIRED
  CANCELLED
}

/// One Wayl payment for one plan period. Its id is the Wayl referenceId.
model Invoice {
  id            String        @id @default(cuid())
  tenantId      String
  /// Shop invoices pay for one store (page); newsroom invoices for the workspace.
  storeId       String?
  /// "SHOP" | "NEWS"
  product       String
  plan          String
  amountIqd     Int
  status        InvoiceStatus @default(PENDING)
  /// "test" | "live"
  env           String        @default("test")
  webhookSecret String
  waylLinkId    String?
  url           String?
  lastError     String?
  paidAt        DateTime?
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
  tenant        Tenant        @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  store         Store?        @relation(fields: [storeId], references: [id], onDelete: SetNull)

  @@index([tenantId, createdAt])
  @@index([status, createdAt])
}
```

  - Add `planPaidUntil DateTime?` and `invoices Invoice[]` to `model Store`. Add `planPaidUntil DateTime?` and `invoices Invoice[]` to `model Tenant`.

- [ ] **Step 2: LITE limits.** In `src/lib/billing/plans.ts`:
  - Change `export type Plan = "MANUAL" | "AUTO" | "ENTERPRISE";` to `export type Plan = "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE";`.
  - Add this first entry to `NEWS_LIMITS`:

```ts
  LITE: { draft: 100, improve: 10, publish: 100, sources: 5, seats: 1, desks: 1 },
```

- [ ] **Step 3:** Run `npx prisma generate && npx tsc --noEmit -p . && npx vitest run`. Expected: all pass.
  - If a test or file enumerates plans exhaustively (for example a `Record<Plan, …>` elsewhere), add a LITE entry there with the smallest values and report it.
  - Do **not** run `prisma db push`.
- [ ] **Step 4: Commit** with the message "Add the LITE newsroom plan and invoices".

---

### Task 2: Prices and the Wayl client

**Files:** Create `src/lib/billing/prices.ts` and `src/lib/billing/wayl.ts`. Tests: `tests/billing/prices.test.ts` and `tests/billing/wayl.test.ts`.

- [ ] **Step 1: Failing tests.**

`tests/billing/prices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extendPaidUntil, PLAN_LABEL, priceFor } from "@/lib/billing/prices";

describe("priceFor", () => {
  it("prices shop and newsroom plans in IQD", () => {
    expect(priceFor("SHOP", "MERCHANT")).toBe(8000);
    expect(priceFor("SHOP", "PRO")).toBe(12000);
    expect(priceFor("NEWS", "LITE")).toBe(25000);
    expect(priceFor("NEWS", "MANUAL")).toBe(155000);
    expect(priceFor("NEWS", "AUTO")).toBe(390000);
    expect(priceFor("NEWS", "ENTERPRISE")).toBe(940000);
  });
  it("refuses plans that are not for sale", () => {
    expect(priceFor("SHOP", "FREE")).toBeNull();
    expect(priceFor("SHOP", "LITE")).toBeNull();
    expect(priceFor("NEWS", "PRO")).toBeNull();
    expect(priceFor("NEWS", "toString")).toBeNull();
  });
  it("labels every plan in Sorani", () => {
    for (const p of ["FREE", "MERCHANT", "PRO", "LITE", "MANUAL", "AUTO", "ENTERPRISE"]) expect(PLAN_LABEL[p]).toBeTruthy();
  });
});

describe("extendPaidUntil", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("starts 30 days from now when nothing is paid or it lapsed", () => {
    expect(extendPaidUntil(null, now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(extendPaidUntil(new Date("2026-09-01T00:00:00Z"), now).toISOString()).toBe("2026-10-31T00:00:00.000Z");
  });
  it("stacks on top of a period that is still running", () => {
    expect(extendPaidUntil(new Date("2026-10-10T00:00:00Z"), now).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
});
```

`tests/billing/wayl.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLink, getLink, signatureValid } from "@/lib/billing/wayl";

describe("signatureValid", () => {
  const raw = '{"referenceId":"inv1","paymentStatus":"Complete"}';
  const hex = createHmac("sha256", "secret-123456").update(raw).digest("hex");
  it("accepts hex, sha256= prefixed hex and base64", () => {
    expect(signatureValid(raw, hex, "secret-123456")).toBe(true);
    expect(signatureValid(raw, `sha256=${hex}`, "secret-123456")).toBe(true);
    expect(signatureValid(raw, createHmac("sha256", "secret-123456").update(raw).digest("base64"), "secret-123456")).toBe(true);
  });
  it("rejects a wrong or missing signature", () => {
    expect(signatureValid(raw, hex, "other-secret")).toBe(false);
    expect(signatureValid(raw + " ", hex, "secret-123456")).toBe(false);
    expect(signatureValid(raw, null, "secret-123456")).toBe(false);
  });
});

describe("Wayl requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  beforeEach(() => { process.env.WAYL_TOKEN = "tok"; delete process.env.WAYL_ENV; });
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); delete process.env.WAYL_TOKEN; });
  const respond = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }));

  it("creates a test-mode IQD link with one line item", async () => {
    respond({ data: { id: "L1", url: "https://link.thewayl.com/pay?id=x", status: "Created" } }, 201);
    const r = await createLink({ referenceId: "inv1", total: 8000, label: "Gituas — بازرگان", webhookUrl: "https://gituas.com/api/billing/wayl", webhookSecret: "s".repeat(32), redirectionUrl: "https://gituas.com/app/billing?invoice=inv1" });
    expect(r).toEqual({ ok: true, link: { id: "L1", url: "https://link.thewayl.com/pay?id=x", status: "Created", total: null } });
    expect(calls[0].url).toBe("https://api.thewayl.com/api/v1/links");
    expect((calls[0].init.headers as Record<string, string>)["X-WAYL-AUTHENTICATION"]).toBe("tok");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      env: "test", referenceId: "inv1", total: 8000, currency: "IQD", customParameter: "",
      lineItem: [{ label: "Gituas — بازرگان", amount: 8000, type: "increase" }],
      webhookUrl: "https://gituas.com/api/billing/wayl", webhookSecret: "s".repeat(32), redirectionUrl: "https://gituas.com/app/billing?invoice=inv1",
    });
  });

  it("reads a link's status and total", async () => {
    respond({ data: { id: "L1", url: "u", status: "Complete", total: "8000" } });
    expect(await getLink("inv1")).toEqual({ id: "L1", url: "u", status: "Complete", total: 8000 });
    expect(calls[0].url).toBe("https://api.thewayl.com/api/v1/links/inv1");
  });

  it("reports failures without throwing", async () => {
    respond({ message: "Store not verified" }, 403);
    const r = await createLink({ referenceId: "inv2", total: 8000, label: "x", webhookUrl: "https://a", webhookSecret: "s".repeat(32), redirectionUrl: "https://b" });
    expect(r.ok).toBe(false);
    expect(await getLink("inv2")).toBeNull();
  });
});
```

Run `npx vitest run tests/billing`. Expected: FAIL (modules not found).

- [ ] **Step 2: Implement** `src/lib/billing/prices.ts`:

```ts
export type BillingProduct = "SHOP" | "NEWS";

export const PERIOD_DAYS = 30;
const DAY = 86_400_000;

/** IQD per month. Shop plans are per store (page); newsroom plans per workspace. */
export const SHOP_PRICES: Record<string, number> = { MERCHANT: 8000, PRO: 12000 };
export const NEWS_PRICES: Record<string, number> = { LITE: 25000, MANUAL: 155000, AUTO: 390000, ENTERPRISE: 940000 };

export const PLAN_LABEL: Record<string, string> = {
  FREE: "بەخۆڕایی",
  MERCHANT: "بازرگان",
  PRO: "پرۆ",
  LITE: "پەیجی بچووک",
  MANUAL: "بنەڕەت",
  AUTO: "پرۆ",
  ENTERPRISE: "دامەزراوە",
};

/** The price of a plan that is for sale, or null. */
export function priceFor(product: BillingProduct, plan: string): number | null {
  const table = product === "SHOP" ? SHOP_PRICES : NEWS_PRICES;
  return Object.hasOwn(table, plan) ? table[plan] : null;
}

/** A payment adds one period after whatever is still running, or from now. */
export function extendPaidUntil(current: Date | null, now: Date, days = PERIOD_DAYS): Date {
  const from = current && current.getTime() > now.getTime() ? current : now;
  return new Date(from.getTime() + days * DAY);
}
```

`src/lib/billing/wayl.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// Wayl (wayl.io) payment links. Docs: https://wayl.io/docs, OpenAPI: https://api.thewayl.com/openapi.v1.json
const BASE = "https://api.thewayl.com";

/** Wayl's status for a paid link. */
export const PAID_STATUS = "Complete";

export function waylConfigured(): boolean {
  return !!process.env.WAYL_TOKEN;
}

/** Test until the owner sets WAYL_ENV=live. */
export function waylEnv(): "test" | "live" {
  return process.env.WAYL_ENV === "live" ? "live" : "test";
}

export interface WaylLink {
  id: string | null;
  url: string | null;
  status: string | null;
  total: number | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toLink(body: unknown): WaylLink {
  const d = ((body as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  const total = typeof d.total === "number" ? d.total : typeof d.total === "string" && d.total.trim() ? Number(d.total) : null;
  return { id: str(d.id), url: str(d.url), status: str(d.status), total: total != null && Number.isFinite(total) ? total : null };
}

async function call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "X-WAYL-AUTHENTICATION": process.env.WAYL_TOKEN ?? "", ...(init.body ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  } catch (e) {
    return { ok: false, status: 0, body: { message: e instanceof Error ? e.message : "request failed" } };
  }
}

export async function createLink(i: {
  referenceId: string;
  total: number;
  label: string;
  webhookUrl: string;
  webhookSecret: string;
  redirectionUrl: string;
}): Promise<{ ok: true; link: WaylLink } | { ok: false; error: string }> {
  const r = await call("/api/v1/links", {
    method: "POST",
    body: JSON.stringify({
      env: waylEnv(),
      referenceId: i.referenceId,
      total: i.total,
      currency: "IQD",
      customParameter: "",
      lineItem: [{ label: i.label.slice(0, 100), amount: i.total, type: "increase" }],
      webhookUrl: i.webhookUrl,
      webhookSecret: i.webhookSecret,
      redirectionUrl: i.redirectionUrl,
    }),
  });
  if (!r.ok) return { ok: false, error: `Wayl ${r.status}: ${JSON.stringify((r.body as { message?: unknown })?.message ?? r.body).slice(0, 200)}` };
  const link = toLink(r.body);
  return link.url ? { ok: true, link } : { ok: false, error: "Wayl returned no link" };
}

/** The link as Wayl sees it now — the authority on whether an invoice is paid. */
export async function getLink(referenceId: string): Promise<WaylLink | null> {
  const r = await call(`/api/v1/links/${encodeURIComponent(referenceId)}`);
  return r.ok ? toLink(r.body) : null;
}

/** HMAC-SHA256 of the raw body with the invoice's secret; Wayl's encoding is not documented, so hex (with or without "sha256=") and base64 are accepted. */
export function signatureValid(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const got = header.trim().replace(/^sha256=/i, "");
  const mac = createHmac("sha256", secret).update(raw);
  const digest = mac.digest();
  for (const expected of [digest.toString("hex"), digest.toString("base64")]) {
    const a = Buffer.from(got.length === 64 ? got.toLowerCase() : got);
    const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
```

- [ ] **Step 3:** Run `npx vitest run tests/billing`. Expected: PASS (10 tests).
- [ ] **Step 4: Commit** with the message "Add billing prices and the Wayl client".

---

### Task 3: Invoices — checkout, confirmation, expiry

**Files:** Create `src/lib/billing/invoices.ts`. It has no unit test (database). tsc and the owner's live test cover it.

- [ ] **Step 1: Implement:**

```ts
import { randomBytes } from "node:crypto";

import { db } from "@/lib/db";
import { SHOP_ORIGIN } from "@/lib/hosts";
import { extendPaidUntil, PLAN_LABEL, priceFor, type BillingProduct } from "./prices";
import { createLink, getLink, PAID_STATUS, waylConfigured, waylEnv } from "./wayl";

const DAY = 86_400_000;
/** Pending invoices older than this are expired by the daily cron. */
export const INVOICE_TTL_MS = 3 * DAY;

export type CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Create an invoice and its Wayl link. The amount always comes from priceFor(),
 * never from the caller. `origin` is where the buyer returns (gituas.com or hawalnoos.com).
 */
export async function startCheckout(i: {
  tenantId: string;
  product: BillingProduct;
  plan: string;
  storeId: string | null;
  origin: string;
  returnPath: string;
}): Promise<CheckoutResult> {
  if (!waylConfigured()) return { ok: false, error: "پارەدان هێشتا ئامادە نییە." };
  const amount = priceFor(i.product, i.plan);
  if (!amount) return { ok: false, error: "پلانەکە دروست نییە." };
  if (i.product === "SHOP") {
    if (!i.storeId || !(await db.store.findFirst({ where: { id: i.storeId, tenantId: i.tenantId }, select: { id: true } }))) {
      return { ok: false, error: "دووکانەکە نەدۆزرایەوە." };
    }
  }
  const secret = randomBytes(24).toString("hex");
  const inv = await db.invoice.create({
    data: { tenantId: i.tenantId, storeId: i.product === "SHOP" ? i.storeId : null, product: i.product, plan: i.plan, amountIqd: amount, env: waylEnv(), webhookSecret: secret },
    select: { id: true },
  });
  const r = await createLink({
    referenceId: inv.id,
    total: amount,
    label: `Gituas — ${PLAN_LABEL[i.plan] ?? i.plan}`,
    webhookUrl: `${SHOP_ORIGIN}/api/billing/wayl`,
    webhookSecret: secret,
    redirectionUrl: `${i.origin}${i.returnPath}?invoice=${inv.id}`,
  });
  if (!r.ok) {
    await db.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED", lastError: r.error } });
    console.error("[billing] Wayl link failed:", r.error);
    return { ok: false, error: "دروستکردنی لینکی پارەدان سەرکەوتوو نەبوو. دواتر هەوڵ بدەرەوە." };
  }
  await db.invoice.update({ where: { id: inv.id }, data: { waylLinkId: r.link.id, url: r.link.url } });
  return { ok: true, url: r.link.url! };
}

/**
 * Ask Wayl whether the invoice is paid; if so, mark it PAID once and apply the plan.
 * Safe to call from the webhook and the return page at the same time.
 */
export async function confirmInvoice(invoiceId: string): Promise<"paid" | "pending" | "missing"> {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return "missing";
  if (inv.status === "PAID") return "paid";
  if (inv.status !== "PENDING") return "missing";
  const link = await getLink(inv.id);
  if (!link || link.status !== PAID_STATUS) return "pending";
  if (link.total != null && link.total !== inv.amountIqd) {
    await db.invoice.update({ where: { id: inv.id }, data: { lastError: `amount mismatch: ${link.total}` } });
    return "pending";
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const claimed = await tx.invoice.updateMany({ where: { id: inv.id, status: "PENDING" }, data: { status: "PAID", paidAt: now } });
    if (claimed.count !== 1) return;
    if (inv.product === "SHOP" && inv.storeId) {
      const s = await tx.store.findUnique({ where: { id: inv.storeId }, select: { planPaidUntil: true } });
      if (s) await tx.store.update({ where: { id: inv.storeId }, data: { plan: inv.plan as "MERCHANT" | "PRO", planPaidUntil: extendPaidUntil(s.planPaidUntil, now) } });
    } else if (inv.product === "NEWS") {
      const t = await tx.tenant.findUnique({ where: { id: inv.tenantId }, select: { planPaidUntil: true } });
      if (t) await tx.tenant.update({ where: { id: inv.tenantId }, data: { plan: inv.plan as "LITE" | "MANUAL" | "AUTO" | "ENTERPRISE", planPaidUntil: extendPaidUntil(t.planPaidUntil, now) } });
    }
    await tx.auditLog.create({
      data: { tenantId: inv.tenantId, actor: "SYSTEM", action: "billing.paid", reasoning: `Paid ${inv.amountIqd} IQD for ${inv.product} ${inv.plan}.`, metadata: { invoiceId: inv.id, env: inv.env } },
    });
  });
  return "paid";
}

/** Daily: lapsed plans drop back, stale pending invoices expire. */
export async function expireOverdue(now = new Date()): Promise<{ stores: number; tenants: number; invoices: number }> {
  const [stores, tenants, invoices] = await Promise.all([
    db.store.updateMany({ where: { planPaidUntil: { lt: now }, NOT: { plan: "FREE" } }, data: { plan: "FREE" } }),
    db.tenant.updateMany({ where: { kind: "NEWS", planPaidUntil: { lt: now }, NOT: { plan: "LITE" } }, data: { plan: "LITE" } }),
    db.invoice.updateMany({ where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - INVOICE_TTL_MS) } }, data: { status: "EXPIRED" } }),
  ]);
  return { stores: stores.count, tenants: tenants.count, invoices: invoices.count };
}
```

- [ ] **Step 2:** Run `npx tsc --noEmit -p .`. Expected: exit 0.
- [ ] **Step 3: Commit** with the message "Create, confirm and expire Wayl invoices".

---

### Task 4: Webhook and daily cron

**Files:** Create `src/app/api/billing/wayl/route.ts` and `src/app/api/cron/billing/route.ts`. Modify `vercel.json`.

- [ ] **Step 1: Webhook** `src/app/api/billing/wayl/route.ts`:

```ts
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { confirmInvoice } from "@/lib/billing/invoices";
import { signatureValid } from "@/lib/billing/wayl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wayl calls this when a link's status changes. The payload only tells us which
 * invoice to look at: confirmInvoice() asks Wayl's API itself before anything is
 * marked paid, so a forged call can at most trigger a harmless re-check.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  let ref: string | null = null;
  try {
    const j = JSON.parse(raw) as { referenceId?: unknown; data?: { referenceId?: unknown } };
    ref = typeof j.referenceId === "string" ? j.referenceId : typeof j.data?.referenceId === "string" ? j.data.referenceId : null;
  } catch {
    /* not JSON */
  }
  if (!ref) return NextResponse.json({ error: "bad payload" }, { status: 400 });
  const inv = await db.invoice.findUnique({ where: { id: ref }, select: { id: true, webhookSecret: true } });
  if (!inv) return NextResponse.json({ ok: true }); // not ours; don't make Wayl retry
  const sig = req.headers.get("x-wayl-signature-256");
  if (sig && !signatureValid(raw, sig, inv.webhookSecret)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const result = await confirmInvoice(inv.id);
  return NextResponse.json({ ok: true, result });
}
```

- [ ] **Step 2: Cron** `src/app/api/cron/billing/route.ts`:

```ts
import { NextResponse } from "next/server";

import { expireOverdue } from "@/lib/billing/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await expireOverdue());
}
```

In `vercel.json`, add `{ "path": "/api/cron/billing", "schedule": "30 4 * * *" }` to the `crons` array.

- [ ] **Step 3:** Run `npx tsc --noEmit -p .`. Expected: exit 0.
- [ ] **Step 4: Commit** with the message "Add the Wayl webhook and the daily billing sweep".

---

### Task 5: Billing actions and pages

**Files:**
- Create `src/app/app/billing/actions.ts`, `src/app/app/billing/page.tsx`, `src/app/app/billing/billing-client.tsx`.
- Create `src/app/newsroom/(desk)/billing/page.tsx`, reusing the client with a `product` prop.
- Modify `src/app/app/settings/page.tsx` (or its client), `src/app/newsroom/(desk)/settings/*` and `src/app/app/automation/automation-client.tsx` to add links.

**Read first:** `src/app/app/automation/page.tsx` and `actions.ts` (guard pattern), `src/app/app/data.ts` (`currentWorkspace`, `Workspace.kind`), `src/lib/hosts.ts` (`isAppOrigin`, `SHOP_ORIGIN`, `NEWSROOM_ORIGIN`), and the newsroom desk layout for how desk pages are structured.

- [ ] **Step 1: Actions** `src/app/app/billing/actions.ts`:

```ts
"use server";

import { headers } from "next/headers";

import { currentWorkspace } from "@/app/app/data";
import { startCheckout, type CheckoutResult } from "@/lib/billing/invoices";
import { isAppOrigin, NEWSROOM_ORIGIN, SHOP_ORIGIN } from "@/lib/hosts";
import { can, NOT_ALLOWED } from "@/lib/newsroom/roles";

/** Return the buyer to the domain they are on, when it is one of ours. */
async function origin(fallback: string): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const o = host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : fallback;
  return isAppOrigin(o) ? o : fallback;
}

export async function startShopCheckoutAction(storeId: string, plan: string): Promise<CheckoutResult> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (!can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  return startCheckout({ tenantId: ws.id, product: "SHOP", plan, storeId, origin: await origin(SHOP_ORIGIN), returnPath: "/app/billing" });
}

export async function startNewsCheckoutAction(plan: string): Promise<CheckoutResult> {
  const ws = await currentWorkspace();
  if (!ws) return { ok: false, error: "چوونەژوورەوە پێویستە." };
  if (ws.kind !== "NEWS" || !can(ws.role, "configure")) return { ok: false, error: NOT_ALLOWED };
  return startCheckout({ tenantId: ws.id, product: "NEWS", plan, storeId: null, origin: await origin(NEWSROOM_ORIGIN), returnPath: "/newsroom/billing" });
}
```

- [ ] **Step 2: Shop page** `/app/billing`:
  - **Server:**
    - Load the workspace. If it cannot `configure`, show `<p className="gm-note warn">{NOT_ALLOWED}</p>`.
    - If `searchParams.invoice` is set **and** that invoice's `tenantId === ws.id`, `await confirmInvoice(id)` and keep the result for a message.
    - Load the workspace's stores (`id`, `name`, `plan`, `planPaidUntil`) and the last 10 invoices (`id`, `plan`, `amountIqd`, `status`, `createdAt`, `paidAt`, `storeId`).
    - Pass `waylConfigured()` and `waylEnv()`.
  - **Client** `billing-client.tsx` (`"use client"`, `useTransition`):
    - Title `پلان و پارەدان`, subtitle `بە FIB، ZainCash، QiCard، FastPay یان کارت — لە ڕێگەی Wayl`.
    - If test mode: `<p className="gm-note warn">مۆدی تاقیکردنەوە — هیچ پارەیەکی ڕاستەقینە وەرناگیرێت.</p>`.
    - If not configured: `<p className="gm-note warn">پارەدان هێشتا ئامادە نییە.</p>`, and disable the buttons.
    - Invoice result message:
      - paid → `gm-ok` `پارەدان سەرکەوتوو بوو — پلانەکەت چالاک کرا.`
      - pending → `gm-hint` `پارەدانەکە هێشتا تەواو نەبووە. ئەگەر پارەت داوە، چەند خولەکێکی تر ئەم پەڕەیە نوێ بکەرەوە.`
    - Per store, a `gm-card`:
      - store name;
      - `پلان: {PLAN_LABEL[plan]}`;
      - if `planPaidUntil`, `<small>چالاکە تا {date}</small>`;
      - buttons for `MERCHANT` and `PRO`: `{PLAN_LABEL} — {formatMoney(price,"IQD","ckb")} بۆ مانگێک`. The label is `نوێکردنەوە` when it is the current paid plan, otherwise `کڕین`.
      - A click calls `startShopCheckoutAction(storeId, plan)`, then `window.location.href = r.url` on success, or shows `gm-err`.
    - The newsroom variant (`product="NEWS"`) shows one card for the workspace with the four plans LITE, MANUAL, AUTO and ENTERPRISE, and calls `startNewsCheckoutAction(plan)`.
    - Invoice history is a list of `gm-target` rows: date, plan label, amount, and a status badge:
      - PAID → `gm-badge` `دراوە`;
      - PENDING → `gm-badge warn` `چاوەڕوان`;
      - EXPIRED / CANCELLED → `gm-badge ghost` `بەسەرچوو` / `هەڵوەشاوە`.
- [ ] **Step 3: Newsroom page** `src/app/newsroom/(desk)/billing/page.tsx`: the same server logic, but for the workspace's plan (`tenant.plan`, `tenant.planPaidUntil`), rendering the client with `product="NEWS"`. Follow how other desk pages are declared.
- [ ] **Step 4: Links.**
  - In the shop settings page, add a `gm-card` row linking to `/app/billing`, labelled `پلان و پارەدان`.
  - In newsroom settings, do the same for `/newsroom/billing`.
  - In `automation-client.tsx`, make the usage section's `پلان: …` line a `gm-link` to `/app/billing`.
- [ ] **Step 5:** Run `npx tsc --noEmit -p . && npx vitest run && npm run build`. All must pass, and the build must list `/app/billing` and `/newsroom/billing`. If `npm run build` changes `package-lock.json`, restore it.
- [ ] **Step 6: Commit** with the message "Add plan and payment pages".

---

### Task 6: Hand-off (controller)

- [ ] Review the branch, then show the SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`. It must be additive, plus one `ALTER TYPE "TenantPlan" ADD VALUE 'LITE'`.
- [ ] The owner:
  1. runs `npx prisma db push --accept-data-loss` (only if Prisma warns; otherwise plain `npx prisma db push`);
  2. adds `WAYL_TOKEN` in Vercel (Production). `WAYL_ENV` stays unset (test) until a test payment succeeds;
  3. runs `git checkout master; git merge --ff-only billing-wayl; git push origin master`.
- [ ] Live test in test mode: `/app/billing` → buy MERCHANT for the test store → Wayl test checkout → back on the page, the plan is active until +30 days.
- [ ] Go live: the owner sets `WAYL_ENV=live` in Vercel and redeploys.
