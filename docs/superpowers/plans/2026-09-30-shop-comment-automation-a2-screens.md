# Shop Comment Automation — A2: Merchant Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants run the automation themselves:
- switches and delivery settings;
- reply samples and templates;
- products with photos and prices;
- which product and template each post uses;
- picking a product while publishing;
- seeing which comments were answered automatically, and which need them.

**Architecture:**
- Pure helpers (`src/lib/shop/forms.ts`) and one loader (`src/lib/shop/state.ts`).
- Server actions in `src/app/app/automation/actions.ts`. Every action checks the workspace, the `configure` permission, and that the store belongs to the workspace.
- Two new pages, `/app/automation` and `/app/products`, follow the existing shop pattern: server page → `useTransition` client → action → inline `gm-ok`/`gm-err`.
- The composer and the comments page gain small additions.
- A1's engine (`src/lib/shop/*`) is reused unchanged, except one policy helper.

**Tech Stack:**
- Next.js 16 App Router, React 19 client components, lucide-react icons.
- Prisma 7 (no schema change in A2).
- `@vercel/blob/client` `upload()` via the existing `/api/app/upload` route.
- vitest for the pure code.

**Spec:** `docs/superpowers/specs/2026-09-30-shop-comment-automation-design.md`, section "Merchant screens".

**Deviation from the spec:**
- The spec asks for a per-post row header on the comments page. Posts without comments are never shown there, so the merchant could not set a product before the first comment. Per-post controls therefore live in a **Posts** section of `/app/automation`. The comments page gets outcome badges and a "needs you" filter instead.
- Named templates are managed on the same page.

**How to build UI tasks:**
- Tasks 5, 6 and 8 give exact fields, labels, classes and behaviour instead of full JSX. Write the JSX yourself, following the files named in each task: `src/app/app/settings/settings-client.tsx` and `src/app/newsroom/(desk)/settings/news-settings.tsx`.
- Use only existing `gm-` classes (listed in the conventions below).
- All visible text is Sorani and exactly as given.

**Conventions:**
- Work on branch `shop-automation-a2`. Commit per task, and end every message with your Co-Authored-By trailer.
- Do not push, run `prisma db push`, or write to the database.
- Run commands from the repo root in Git Bash.

**Existing classes (from `src/app/app/app.css`):**
- Layout: `gm-card`, `gm-stack`, `gm-row`, `gm-between`.
- Text: `gm-title` (with `kufi`), `gm-sub`, `gm-sec`, `gm-hint`, `gm-err`, `gm-ok`, `gm-note`, `gm-note warn`.
- Form: `gm-field` (label), `gm-input` (also used for `<select>`), `gm-textarea`, `gm-knob` + `<i/>` with `role="switch" aria-checked`, and `gm-radio` wrapping a bare checkbox.
- Buttons: `gm-btn`, `quiet`, `danger`, `small`, `block`, `gm-link`.
- Chips, badges, platforms: `gm-chips`, `gm-chip[aria-pressed]`, `gm-badge` (`warn`, `ghost`), `gm-plat FB|IG`.
- Lists and empty state: `gm-target` (a row with `p`, `small` and a control), `gm-empty` with `<b className="kufi">`.

---

## File map

| File | Change |
|---|---|
| `src/lib/shop/policy.ts` | + `limitDecision()` |
| `src/lib/shop/pipeline.ts` | Author-limited comments are still classified, spam is still hidden, and the merchant is still flagged |
| `src/lib/shop/forms.ts` | New: digit normalising, price parsing, sample cleaning, flag-reason labels, `needsYou()` |
| `src/lib/shop/state.ts` | New: `loadShopState()`, `loadCommentOutcomes()`, `tagPublishedPost()` |
| `src/app/app/automation/actions.ts` | New: settings, template, post and product actions |
| `src/app/app/automation/page.tsx`, `automation-client.tsx` | New page |
| `src/app/app/products/page.tsx`, `products-client.tsx` | New page |
| `src/app/app/nav.tsx`, `src/app/app/app.css` | Merchant "ئۆتۆمەیشن" tab; tab grid adapts to the tab count |
| `src/app/app/actions.ts`, `src/app/app/publish/page.tsx`, `publish-client.tsx` | Product picker; tag the published post |
| `src/app/app/comments/page.tsx`, `comments-client.tsx` | Outcome badges and a "needs you" filter |
| `tests/shop/forms.test.ts`, `tests/shop/policy.test.ts` | Tests |

---

### Task 1: Repeat comments still get hidden and flagged

A1 skips a second comment from the same author on the same post before classifying it. A spammer's second comment then stays visible, and a later complaint never reaches the merchant.

**Files:** Modify `src/lib/shop/policy.ts`, `src/lib/shop/pipeline.ts`. Test: `tests/shop/policy.test.ts`.

- [ ] **Step 1: Failing test.** Append to `tests/shop/policy.test.ts`:

```ts
import { limitDecision } from "@/lib/shop/policy";

describe("limitDecision", () => {
  it("keeps only hiding and the flag for an author already answered on this post", () => {
    expect(limitDecision({ actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, { kind: "LIKE" }], flag: null })).toEqual({ actions: [], flag: null });
    expect(limitDecision({ actions: [{ kind: "HIDE" }], flag: "spam" })).toEqual({ actions: [{ kind: "HIDE" }], flag: "spam" });
    expect(limitDecision({ actions: [], flag: "complaint" })).toEqual({ actions: [], flag: "complaint" });
  });
});
```

Run `npx vitest run tests/shop/policy.test.ts`. Expected: FAIL (`limitDecision` is not exported).

- [ ] **Step 2: Implement.** Append to `src/lib/shop/policy.ts`:

```ts
/** An author already answered on this post today: never reply again, but still hide spam and flag what needs the merchant. */
export function limitDecision(d: CommentDecision): CommentDecision {
  return { actions: d.actions.filter((a) => a.kind === "HIDE"), flag: d.flag };
}
```

- [ ] **Step 3: Use it in `planComment`** (`src/lib/shop/pipeline.ts`).
  - Add `limitDecision` to the import from `./policy`.
  - Replace

```ts
  if (!g.ok) {
    await finish(msg.id, "SKIPPED", g.reason);
    return [];
  }
```

with

```ts
  if (!g.ok && g.reason !== "author_limit") {
    await finish(msg.id, "SKIPPED", g.reason);
    return [];
  }
  // Already answered this author on this post today: classify anyway, so spam is still hidden and complaints still flagged.
  const limited = !g.ok;
```

  - Rename the existing `const decision = decideComment(c, {...});` to `const full = decideComment(c, {...});`, and directly after it add:

```ts
  const decision = limited ? limitDecision(full) : full;
```

  - Directly before the final `const replied = …` line, add:

```ts
  if (limited && !decision.flag && !specs.length) {
    await finish(msg.id, "SKIPPED", "author_limit", { commentType: c.type, intent: c.intent, language: c.language, confidence: c.confidence });
    return [];
  }
```

- [ ] **Step 4:** Run `npx vitest run tests/shop && npx tsc --noEmit -p .`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit** with the message "Hide and flag repeat comments instead of skipping them".

---

### Task 2: Form helpers

**Files:** Create `src/lib/shop/forms.ts`. Test: `tests/shop/forms.test.ts`.

- [ ] **Step 1: Failing test** `tests/shop/forms.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cleanSamples, needsYou, parsePrice, REASON_LABEL, toWesternDigits } from "@/lib/shop/forms";

describe("toWesternDigits", () => {
  it("turns Arabic-Indic and Persian digits into 0-9", () => {
    expect(toWesternDigits("٢٥٬٠٠٠ و ۱۲")).toBe("25٬000 و 12");
  });
});

describe("parsePrice", () => {
  it("reads IQD in any digits and separators", () => {
    expect(parsePrice("25,000", "IQD")).toBe(25000);
    expect(parsePrice("٢٥٬٠٠٠", "IQD")).toBe(25000);
    expect(parsePrice(" 25000 ", "IQD")).toBe(25000);
  });
  it("reads USD into cents", () => {
    expect(parsePrice("19.99", "USD")).toBe(1999);
    expect(parsePrice("20", "USD")).toBe(2000);
    expect(parsePrice("١٢٫٥", "USD")).toBe(1250);
  });
  it("rejects empty, zero, fractions of a dinar and junk", () => {
    for (const bad of ["", "0", "25.5", "abc", "-5", "1e5"]) expect(parsePrice(bad, "IQD")).toBeNull();
    expect(parsePrice("1.234", "USD")).toBeNull();
  });
});

describe("cleanSamples", () => {
  it("trims, drops empties, keeps five, caps length", () => {
    expect(cleanSamples([" a ", "", "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(cleanSamples(["x".repeat(400)])[0]).toHaveLength(300);
  });
});

describe("needsYou", () => {
  it("is true for flags meant for the merchant, false for routine skips", () => {
    for (const r of ["negotiation", "complaint", "abuse", "spam", "other", "low_confidence", "no_product", "private_window", "unclear", "needs_you", "no_action"]) {
      expect(needsYou(r)).toBe(true);
      expect(REASON_LABEL[r]).toBeTruthy();
    }
    for (const r of [null, "self", "store_off", "post_expired", "author_limit", "daily_cap", "thread_paused"]) expect(needsYou(r)).toBe(false);
  });
});
```

Run it. Expected: FAIL (module not found).

- [ ] **Step 2: Implement** `src/lib/shop/forms.ts`:

```ts
import { exponentOf } from "./money";

const EASTERN = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

export function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(EASTERN.includes(d) ? EASTERN.indexOf(d) : PERSIAN.indexOf(d)));
}

/** What merchants type ("25,000", "٢٥٬٠٠٠", "19.99") → minor units, or null. IQD has no fractions. */
export function parsePrice(raw: string, currency: string): number | null {
  const t = toWesternDigits(raw).trim().replace(/[\s,٬،']/g, "").replace("٫", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const exp = exponentOf(currency);
  if (exp === 0 && t.includes(".")) return null;
  const n = Math.round(Number(t) * 10 ** exp);
  return n > 0 && n <= 1e12 ? n : null;
}

/** Reply samples as stored: trimmed, non-empty, at most five, each at most 300 characters. */
export function cleanSamples(xs: string[], max = 5, maxLen = 300): string[] {
  return xs.map((s) => s.trim()).filter(Boolean).slice(0, max).map((s) => Array.from(s).slice(0, maxLen).join(""));
}

/** Why a comment or DM is waiting for the merchant (outcomeReason → Sorani). */
export const REASON_LABEL: Record<string, string> = {
  negotiation: "داوای داشکاندن",
  complaint: "گلەیی",
  abuse: "جنێو",
  spam: "سپام",
  other: "پێویستی بە تۆیە",
  low_confidence: "دڵنیا نییە",
  no_product: "کارتی بەرهەم نییە",
  private_window: "درەنگە بۆ نامەی تایبەت",
  unclear: "ڕوون نییە",
  needs_you: "پێویستی بە تۆیە",
  no_action: "پێویستی بە تۆیە",
};

/** Flags meant for the merchant, as opposed to routine skips (self, switched off, expired, caps). */
export function needsYou(reason: string | null): boolean {
  return !!reason && reason in REASON_LABEL;
}
```

- [ ] **Step 3:** Run `npx vitest run tests/shop/forms.test.ts`. Expected: PASS (6 tests).
- [ ] **Step 4: Commit** with the message "Add shop form helpers".

---

### Task 3: State loader and post tagging

**Files:** Create `src/lib/shop/state.ts`. It has no unit test (database). Task 9 checks it via tsc and the build.

- [ ] **Step 1: Implement** `src/lib/shop/state.ts`:

```ts
import { db } from "@/lib/db";
import type { MetaPlatform } from "./meta-client";
import { startOfUtcDay } from "./pipeline";
import { dailyCap, SHOP_LIMITS, type StorePlan } from "./plans";
import { aiVaryUsed } from "./quota";

const DAY = 86_400_000;

/** Everything the automation and products pages show for one store of a workspace. */
export async function loadShopState(tenantId: string, storeId?: string) {
  const stores = await db.store.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;
  if (!store) return { stores, store: null } as const;
  const now = new Date();
  const [templates, products, posts, activePosts, sentToday, aiUsed] = await Promise.all([
    db.automationTemplate.findMany({ where: { storeId: store.id }, orderBy: { createdAt: "asc" } }),
    db.product.findMany({ where: { storeId: store.id, active: true }, include: { variants: { orderBy: { position: "asc" } } }, orderBy: { updatedAt: "desc" } }),
    db.postAutomation.findMany({ where: { storeId: store.id }, orderBy: { postCreatedAt: "desc" }, take: 60 }),
    db.postAutomation.count({ where: { storeId: store.id, enabled: true, activeUntil: { gt: now } } }),
    db.outboxJob.count({ where: { storeId: store.id, status: "SENT", kind: { in: ["PUBLIC_REPLY", "PRIVATE_REPLY", "DM_ANSWER"] }, updatedAt: { gte: startOfUtcDay(now) } } }),
    aiVaryUsed(store.id),
  ]);
  const plan = store.plan as StorePlan;
  return {
    stores,
    store,
    templates,
    products,
    posts,
    usage: { plan, activePosts, postSlots: SHOP_LIMITS[plan].posts, sentToday, cap: dailyCap(plan, store.dailyCap), aiUsed, aiLimit: SHOP_LIMITS[plan].aiVaryPerMonth },
  } as const;
}

/** Automation outcome per comment id, for badges on the comments page. Workspaces without a store get {}. */
export async function loadCommentOutcomes(tenantId: string, commentIds: string[]): Promise<Record<string, { outcome: string | null; reason: string | null }>> {
  if (!commentIds.length) return {};
  const rows = await db.conversationMessage.findMany({
    where: { store: { tenantId }, channelType: "COMMENT", externalMessageId: { in: commentIds } },
    select: { externalMessageId: true, outcome: true, outcomeReason: true },
  });
  return Object.fromEntries(rows.map((r) => [r.externalMessageId!, { outcome: r.outcome, reason: r.outcomeReason }]));
}

/** After publishing from the composer with a product chosen: tag the new post so its first comment already has the card. */
export async function tagPublishedPost(tenantId: string, platform: MetaPlatform, externalPostId: string, productId: string): Promise<void> {
  const store = await db.store.findFirst({
    where: { tenantId, ...(platform === "META_FACEBOOK" ? { fbPageId: { not: null } } : { igUserId: { not: null } }) },
    orderBy: { createdAt: "asc" },
    select: { id: true, expiryDays: true },
  });
  if (!store) return;
  const product = await db.product.findFirst({ where: { id: productId, storeId: store.id, active: true }, select: { id: true } });
  if (!product) return;
  const now = new Date();
  await db.postAutomation.upsert({
    where: { storeId_platform_externalPostId: { storeId: store.id, platform, externalPostId } },
    create: { storeId: store.id, platform, externalPostId, postCreatedAt: now, activeUntil: new Date(now.getTime() + store.expiryDays * DAY), productId: product.id },
    update: { productId: product.id, enabled: true },
  });
}
```

- [ ] **Step 2:** Run `npx tsc --noEmit -p .`. Expected: exit 0.
- [ ] **Step 3: Commit** with the message "Load shop automation state and tag published posts".

---

### Task 4: Server actions

**Files:** Create `src/app/app/automation/actions.ts`. There are no unit tests (database). Validation lives in `forms.ts` (tested).

- [ ] **Step 1: Implement:**

```ts
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
  if ("error" in r) return { ok: false, error: r.error };
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
  if ("error" in r) return { ok: false, error: r.error };
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
  if ("error" in r) return { ok: false, error: r.error };
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
  if ("error" in r) return { ok: false, error: r.error };
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
  if ("error" in r) return { ok: false, error: r.error };
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
  if ("error" in r) return { ok: false, error: r.error };
  const { count } = await db.product.updateMany({ where: { id: productId, storeId: r.store.id }, data: { active: false } });
  if (!count) return { ok: false, error: "بەرهەمەکە نەدۆزرایەوە." };
  return done();
}
```

- [ ] **Step 2:** Run `npx tsc --noEmit -p .`. Expected: exit 0. Fix only type errors, keep the behaviour, and report the fixes.
- [ ] **Step 3: Commit** with the message "Add shop automation server actions".

---

### Task 5: The Automation page and its tab

**Files:**
- Create `src/app/app/automation/page.tsx` and `src/app/app/automation/automation-client.tsx`.
- Modify `src/app/app/nav.tsx` and `src/app/app/app.css`.

**Read first:**
- `src/app/app/settings/page.tsx` and `settings-client.tsx`: the page and client pattern, inline messages, `useTransition`.
- `src/app/newsroom/(desk)/settings/news-settings.tsx`: switch rows.
- `src/app/app/comments/comments-client.tsx`: post thumbnails and platform chips.

- [ ] **Step 1: Nav.**
  - In `nav.tsx`, add a merchant-only tab after the shop's first tab: `{ href: `${base}/automation`, label: "ئۆتۆمەیشن", Icon: Bot }` (import `Bot` from lucide-react). Newsroom tabs stay as they are.
  - In `app.css`, change `.gm-tabs nav`'s `grid-template-columns: repeat(5, 1fr)` to `grid-auto-flow: column; grid-auto-columns: 1fr;` so 5 or 6 tabs both fit.

- [ ] **Step 2: Server page** `page.tsx`:
  - `export const dynamic = "force-dynamic";`
  - `const ws = (await currentWorkspace())!`.
  - If `!can(ws.role, "configure")`, render `<p className="gm-note warn">{NOT_ALLOWED}</p>`.
  - Read `searchParams` (a Promise) for `store`.
  - `const state = await loadShopState(ws.id, sp.store)`.
  - If `!state.store`, render a `gm-empty` with the heading "هێشتا پەیجێکت پەیوەست نەکردووە". Below it put the text "لە ڕێکخستنەکان فەیسبووک یان ئینستاگرام پەیوەست بکە، ئینجا ئۆتۆمەیشن لێرە دەردەکەوێت." and a `gm-link` to `/app/settings` labelled "ڕێکخستنەکان".
  - Otherwise also load `loadConnections(ws.id)` and `loadPosts(ws.id, conns, 8)`, and pass everything to `<AutomationClient>`:
    - store fields;
    - templates;
    - products (`id`, `name`);
    - `postAutomations` as a plain map keyed by `${platform}:${externalPostId}`, with `enabled`, `productId`, `templateId`, `activeUntil` (ISO);
    - recent posts from `loadPosts` (`platform`, `id`, `caption`, `thumbUrl`, `createdAt`);
    - `usage`;
    - `stores` (`id`, `name`) for the store switcher.
  - Serialize Dates as ISO strings.

- [ ] **Step 3: Client** `automation-client.tsx` (`"use client"`).
  - Page title `ئۆتۆمەیشن` (`gm-title kufi`), subtitle `وەڵامدانەوەی خۆکار بۆ کۆمێنت و نامە` (`gm-sub`).
  - If there is more than one store, show a `<select className="gm-input">` that navigates to `?store=<id>`.
  - Sections are `gm-card`s, in this order:
  1. **دۆخ**:
     - A switch row: `<p>ئۆتۆمەیشن</p><small>{on ? "چالاکە — وەڵام دەدرێتەوە" : "کوژاوەتەوە — هیچ شتێک نانێردرێت"}</small>`.
     - If `store.pausedReason`, show `<p className="gm-note warn">پەیجەکەت دووبارە پەیوەست بکەرەوە — تۆکنەکەی بەسەرچووە.</p>`.
     - The switch saves immediately via `saveStoreSettingsAction` with all current settings plus the new value.
  2. **بەکارهێنان**: three `gm-target` rows:
     - `پۆستی چالاک`, value `activePosts / (postSlots ?? "هەموو")`;
     - `وەڵامی ئەمڕۆ`, value `sentToday / cap`;
     - `گۆڕینی AI ئەم مانگە`, value `aiUsed / aiLimit`;
     - and `<small>پلان: {plan}</small>`.
  3. **ئامادەکاری** (checklist): rows with ✓ or ○:
     - "پەیج پەیوەستە" (always ✓ here);
     - "ئاگادارکردنەوەکانی Meta تۆمار کراون" (`store.webhooksAt`);
     - "لانیکەم یەک بەرهەم" (`products.length > 0`), with a link to `/app/products` labelled `بەرهەمەکان`;
     - "نموونەی وەڵام نووسراوە" (the default template has public samples; if not, the hint `ئەگەر ننووسیت، نموونەی ئامادە بەکاردێت`);
     - an always-shown `gm-hint`: `ئینستاگرام: Settings ← Messages and story replies ← Connected tools ← Allow access to messages چالاک بکە، ئەگینا نامە ناگات.`
  4. **وەڵامەکان** (the default template):
     - two `gm-textarea`s, one sample per line:
       - label `نموونەی وەڵام بۆ پرسیار (هەر دێڕێک یەک نموونە، تا ٥)`;
       - label `نموونەی سوپاس (تا ٥)`.
     - `gm-hint`: `AI هەر جارێک بە زمانی کڕیار دەیگۆڕێت و هیچ ژمارەیەک ناخاتە سەری. وەڵامی گشتی تەنها کاتێک دەچێت کە نامەی تایبەتیش بچێت.`
     - Two checkbox rows (`gm-radio`): `سڵاوی AI لە سەرەتای نامەدا` (dmGreeting) and `لینکی واتسئەپ هەمیشە لە نامەکەدا بێت` (whatsappAlways).
     - Button `پاشەکەوت` saves via `saveTemplateAction(storeId, defaultTemplate?.id ?? null, { name: defaultTemplate?.name ?? "بنەڕەت", …, makeDefault: true })`.
  5. **تێمپلەیتەکانی تر**:
     - A list of non-default templates, each row with its name and buttons `دەستکاری` (opens the same editor inline), `بیکە بە بنەڕەت`, and `سڕینەوە` (`gm-btn small danger`, confirm with `window.confirm("ئەم تێمپلەیتە بسڕدرێتەوە؟")`).
     - A button `تێمپلەیتی نوێ` opens an empty editor with a name field `ناو`.
  6. **نامەی تایبەت و گەیاندن**:
     - `gm-textarea` labelled `نامەی تایبەت بۆ پۆستێک کە کارتی بەرهەمی نییە`;
     - input `کرێی گەیاندن (دینار، 0 = بەخۆڕایی)`;
     - input `ماوەی گەیاندن (بۆ نموونە: ١-٢ ڕۆژ)`;
     - button `پاشەکەوت`.
  7. **کۆمێنت**:
     - switch rows `لایکی کۆمێنت بکە` (small: `تەنها فەیسبووک`) and `سپام و جنێو بشارەوە`;
     - number input `پۆستەکان دوای چەند ڕۆژ بوەستن` (expiryDays);
     - date input `پۆستەکانی پێش ئەم ڕێکەوتە ئۆتۆمەیشنیان نەبێت` (stopBefore);
     - button `پاشەکەوت`.
  8. **پۆستەکان**: for each recent post, a row with:
     - thumbnail, `gm-plat`, the caption's first 60 characters, and `<small>` "چالاکە تا {date}" (or "کوژاوەتەوە");
     - a switch (enabled; the default when there is no row is on);
     - a `<select className="gm-input">` for the product (`بێ کارتی بەرهەم` + products);
     - a `<select>` for the template (`بنەڕەت` + templates).
     - Each change calls `setPostAutomationAction(storeId, { platform, postId, postCreatedAt, <changed field> })`.
     - Empty state: `هیچ پۆستێک نەدۆزرایەوە`.
  - Every save uses `useTransition`, shows `gm-ok` ("پاشەکەوت کرا") or `gm-err` (the action's error), and calls `router.refresh()` on success.
  - Disable controls while pending.

- [ ] **Step 4:** Run `npx tsc --noEmit -p . && npm run build`. Expected: exit 0, and the build lists `/app/automation`.
- [ ] **Step 5: Commit** with the message "Add the shop Automation page".

---

### Task 6: The Products page

**Files:** Create `src/app/app/products/page.tsx` and `src/app/app/products/products-client.tsx`.

**Read first:**
- `src/app/app/publish/publish-client.tsx`, around lines 140-160: the `upload()` call with `handleUploadUrl: "/api/app/upload"`, the path prefix `merchant/${workspaceId}/`, and non-JPEG → JPEG conversion via `./publish/to-jpeg`.
- `src/app/api/app/upload/route.ts`: allowed types.

- [ ] **Step 1: Server page:**
  - Same guard as Task 5 (workspace, `configure`, `loadShopState`).
  - If there is no store, show the same empty state as Task 5.
  - Otherwise pass `workspaceId` (for the upload path), `storeId`, and products with variants (`label`, `amountMinor`, `currency`, `inStock`) to the client.

- [ ] **Step 2: Client:**
  - Title `بەرهەمەکان`, subtitle `نرخ و وێنەکان لێرە دادەنرێن — ژمارەکان هەرگیز لە AIیەوە نایەن`.
  - A button `بەرهەمی نوێ`.
  - The list is `gm-card`s. Each shows the first photo (thumbnail), the name, and variants as chips `label: formatted price` (use `formatMoney(amountMinor, currency, "ckb")` from `@/lib/shop/money`). Buttons: `دەستکاری`, and `سڕینەوە` (`archiveProductAction`, confirm `ئەم بەرهەمە بسڕدرێتەوە؟`).
  - Empty: `gm-empty` with `<b className="kufi">هێشتا هیچ بەرهەمێک نییە</b>` and the text `بەرهەمێک زیاد بکە، ئینجا لە پەڕەی ئۆتۆمەیشن بیبەستەوە بە پۆستەکانەوە.`
  - **Editor** (inline card):
    - `ناو` (required);
    - `وەسف (ئارەزوومەندانە)` textarea;
    - **Photos**, `وێنەکان (تا ٥)`: a file input (`image/*`).
      - Each file is converted to JPEG if needed (reuse the composer's `to-jpeg` helper).
      - Upload with `upload(`merchant/${workspaceId}/product-${Date.now()}.jpg`, file, { access: "public", handleUploadUrl: "/api/app/upload", contentType: "image/jpeg" })`, and store `blob.url`.
      - Show thumbnails, each with a remove ✕.
    - **Variants** (`جۆرەکان`): rows with:
      - `جۆر (قیاس/ڕەنگ)` text; it may be empty only when there is a single row;
      - `نرخ` text (`inputMode="decimal"`, accepts ٢٥٬٠٠٠ or 25,000);
      - `دراو` select (`IQD` "دینار", `USD` "دۆلار");
      - a `بەردەستە` checkbox;
      - a ✕ remove button.
    - Button `+ جۆری تر`.
    - Save `پاشەکەوت` → `saveProductAction(storeId, id|null, …)`. Cancel `پاشگەزبوونەوە`.
  - Show action errors in `gm-err`.
  - Add a link from the Automation page checklist (done in Task 5).

- [ ] **Step 3:** Run `npx tsc --noEmit -p . && npm run build`. Expected: exit 0, with `/app/products` listed.
- [ ] **Step 4: Commit** with the message "Add the shop Products page".

---

### Task 7: Product picker in the composer

**Files:** Modify `src/app/app/actions.ts` (`PublishInput`, `PublishOutcome`, `publishAction`), `src/app/app/publish/page.tsx`, `src/app/app/publish/publish-client.tsx`.

- [ ] **Step 1: Action.** In `src/app/app/actions.ts`:
  - Add `productId?: string;` to `PublishInput`, and `externalId?: string;` to `PublishOutcome`.
  - In the Facebook and Instagram branches of `publishAction`, where the outcome is built from the publisher result `r`, also set `externalId: r.externalId`.
  - At the end of `publishAction`, after all outcomes are collected and before returning, add:

```ts
  if (input.productId) {
    for (const o of outcomes) {
      if (o.ok && o.externalId && (o.target === "FB" || o.target === "IG")) {
        await tagPublishedPost(ws.id, o.target === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", o.externalId, input.productId).catch(() => {});
      }
    }
  }
```

  Import `tagPublishedPost` from `@/lib/shop/state`. Read the function first to use the real names of the outcomes array and the workspace variable, and adapt them if they differ.

- [ ] **Step 2: Page.** In `publish/page.tsx`, load `const products = await db.product.findMany({ where: { active: true, store: { tenantId: ws.id } }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" } });` and pass `products` to `PublishClient`.
- [ ] **Step 3: Client.** In `publish-client.tsx`, when `products.length > 0`, show above the targets:
  - a `gm-field` with label `کارتی بەرهەم (ئارەزوومەندانە)`;
  - a `<select className="gm-input">` with the options `بێ کارت` + products;
  - `gm-hint`: `ئەگەر هەڵیبژێریت، هەر کەسێک پرسیاری نرخ بکات، نامەیەکی تایبەت بە نرخ و وێنەکانەوە بە خۆکاری بۆی دەچێت.`

  Include `productId` (or `undefined`) in the `publishAction` input.
- [ ] **Step 4:** Run `npx tsc --noEmit -p . && npx vitest run`. Expected: exit 0, all tests pass.
- [ ] **Step 5: Commit** with the message "Pick a product card when publishing".

---

### Task 8: Outcome badges and "needs you" on the comments page

**Files:** Modify `src/app/app/comments/page.tsx` and `src/app/app/comments/comments-client.tsx`.

- [ ] **Step 1: Page.** After `loadPosts`:
  - Collect every comment id, top-level and replies (`post.comments[].id` and their `replies[].id`).
  - Call `const outcomes = await loadCommentOutcomes(ws.id, ids)` from `@/lib/shop/state`, and pass `outcomes` to `CommentsClient`.
  - The newsroom re-exports this page; workspaces without a store simply get `{}`.
- [ ] **Step 2: Client.**
  - Accept `outcomes: Record<string, { outcome: string | null; reason: string | null }>`.
  - In the comment item, next to the author:
    - if `outcomes[c.id]?.outcome === "AUTO_REPLIED"`, render `<span className="gm-badge ghost">وەڵامی خۆکار</span>`;
    - if `needsYou(outcomes[c.id]?.reason ?? null)`, render `<span className="gm-badge warn">{REASON_LABEL[reason]}</span>` (from `@/lib/shop/forms`).
  - Add a filter to the existing `FILTERS` pills, labelled `پێویستی بە تۆیە`. It shows only comments (or posts with at least one comment) where `needsYou(...)` is true. Follow the existing FILTERS shape and filtering code; read it first.
- [ ] **Step 3:** Run `npx tsc --noEmit -p . && npm run build`. Expected: exit 0.
- [ ] **Step 4: Commit** with the message "Show automation outcomes on the comments page".

---

### Task 9: Final check (controller)

- [ ] Run `npx vitest run && npx tsc --noEmit -p . && npm run build`. Everything must pass.
- [ ] Review the whole branch diff against this plan and the spec's "Merchant screens" section.
- [ ] Hand the owner the one-line deploy command:
  ```
  git checkout master; git merge --ff-only shop-automation-a2; git push origin master
  ```
  The agent cannot push. Then verify with `gh api repos/zorino96/gituas/commits/master/status --jq .state`.
- [ ] Live check: open `https://gituas.com/app/automation` in the owner's browser. The owner is signed in; the agent does not sign in. Check that the store, the usage and the checklist show and that saving works.
