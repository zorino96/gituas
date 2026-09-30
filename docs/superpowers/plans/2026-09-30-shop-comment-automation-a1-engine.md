# Shop Comment Automation — A1: the Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a buyer comments on or messages a merchant's Facebook Page or Instagram account, the shop answers by itself. Questions get a public reply plus a private product card. Praise gets a thank-you. Anything else is flagged for the merchant. Everything is driven by settings stored in the database.

**Architecture:**
- The Meta webhook resolves the account to a new `Store`, stores the event idempotently and hands it to `processMessage()` in `after()`.
- `processMessage` runs the pure decision units (`gate` → `policy` → `compose` → `jobs`) with two AI calls (`classify`, `vary`). It writes one `OutboxJob` per outgoing action and sends them through `meta-client`.
- A cron route retries due jobs and picks up messages that were never processed.
- The merchant screens are plan A2. This plan ships the engine plus operator scripts, so it can be switched on and tested live on the owner's own Page and Instagram account.

**Tech Stack:**
- Next.js 16 App Router (`after()` from `next/server`) and TypeScript.
- Prisma 7 with `prisma db push` against the production Neon DB.
- vitest, and Graph API v25.0.
- DeepSeek via the existing `completeJson`, with Gemini as fallback.

**Spec:** `docs/superpowers/specs/2026-09-30-shop-comment-automation-design.md` (read it first).

**Conventions:**
- Run every command from the repo root `C:\Users\Zorin\Desktop\gituas`, in the Bash tool (Git Bash).
- Tests live in `tests/shop/*.test.ts` and import from `@/lib/...` (vitest alias).
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never print `.env` / `.env.local` values. Scripts that need them use `npx tsx --env-file=.env --env-file=.env.local <script>`.

---

## File map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | New: `Store`, `Product`, `ProductVariant`, `AutomationTemplate`, `PostAutomation`, `OutboxJob`, `ThreadPause`. Enums: `StorePlan`, `OutboxKind`, `OutboxStatus`, `MessageOutcome`. `ConversationMessage` gains store fields. |
| `src/lib/shop/plans.ts` | Per-plan limits (posts, replies/day, AI rewrites/month) |
| `src/lib/shop/digits.ts` | `hasDigit()`: the numbers guard |
| `src/lib/shop/money.ts` | `Lang` type and `formatMoney()` per language |
| `src/lib/shop/webhook-parse.ts` | Pure: one Meta webhook entry → `ShopEvent[]` |
| `src/lib/shop/gate.ts` | Pure: may this comment or DM be automated, and if not, why |
| `src/lib/shop/policy.ts` | Pure: classification → actions + flag; the `Classification` types |
| `src/lib/shop/compose.ts` | Pure: copy per language, DM text, answers, FB card elements, WhatsApp text |
| `src/lib/shop/jobs.ts` | Pure: decision + composed text → `JobSpec[]` (payloads for the outbox) |
| `src/lib/shop/classify.ts` | AI labels only (`classifyText`) and their validator |
| `src/lib/shop/vary.ts` | AI rewrite of a sample, with the digit and length guard and a verbatim fallback |
| `src/lib/shop/meta-errors.ts` | Pure: Graph error → failure kind; retry and backoff rules |
| `src/lib/shop/meta-client.ts` | Graph calls per store account: reply, private reply, like, hide, DM, post time, webhook subscription |
| `src/lib/shop/quota.ts` | Per-store monthly AI-rewrite counter (on the existing `Usage` table) |
| `src/lib/shop/store.ts` | `pickStoreForAccount()` (pure) and `connectStore()` (create or link the store, subscribe webhooks) |
| `src/lib/shop/pause.ts` | `pauseThread()`: a manual reply stops automation on that thread |
| `src/lib/shop/outbox.ts` | `runJob()`: send one job, record the result, retry or pause |
| `src/lib/shop/pipeline.ts` | `processMessage()`: loads, gates, classifies, decides, creates jobs, runs them |
| `src/app/api/meta/webhooks/route.ts` | Store accounts go to the shop pipeline; others keep the old Project path |
| `src/lib/oauth/flow.ts` | Calls `connectStore()` after a Page or Instagram credential is saved |
| `src/app/app/actions.ts` | Manual comment reply / DM → `pauseThread()` |
| `src/app/api/cron/shop-outbox/route.ts` + `vercel.json` | Retry sweep |
| `scripts/shop-stores.mts`, `scripts/shop-demo.mts` | Operator: backfill stores; configure a test store |

---

### Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the enums and new models**

Append to the end of `prisma/schema.prisma`:

```prisma
enum StorePlan {
  FREE
  MERCHANT
  PRO
}

enum OutboxKind {
  PUBLIC_REPLY
  PRIVATE_REPLY
  LIKE
  HIDE
  DM_ANSWER
  DM_PHOTOS
}

enum OutboxStatus {
  PENDING
  SENT
  SKIPPED
  FAILED
}

enum MessageOutcome {
  AUTO_REPLIED
  FLAGGED
  SKIPPED
}

/// One connected Facebook Page and/or Instagram account that the shop automates.
model Store {
  id                String               @id @default(cuid())
  tenantId          String
  name              String               @default("")
  fbPageId          String?              @unique
  igUserId          String?              @unique
  igUsername        String?
  plan              StorePlan            @default(FREE)
  automationEnabled Boolean              @default(false)
  expiryDays        Int                  @default(30)
  /// Lower than the plan's daily reply cap, when the merchant wants that.
  dailyCap          Int?
  likeComments      Boolean              @default(true)
  autoHideSpam      Boolean              @default(false)
  deliveryFeeMinor  Int?
  deliveryCurrency  String               @default("IQD")
  deliveryTime      String?
  defaultDm         String?
  defaultTemplateId String?
  /// Posts created before this date are never automated ("stop old posts").
  stopBefore        DateTime?
  /// Set when sending must stop (e.g. "token"); cleared on reconnect.
  pausedReason      String?
  /// Last successful webhook subscription.
  webhooksAt        DateTime?
  createdAt         DateTime             @default(now())
  updatedAt         DateTime             @updatedAt
  tenant            Tenant               @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  products          Product[]
  templates         AutomationTemplate[]
  posts             PostAutomation[]
  jobs              OutboxJob[]
  messages          ConversationMessage[]

  @@index([tenantId])
}

model Product {
  id          String           @id @default(cuid())
  storeId     String
  name        String
  description String?
  photos      String[]
  active      Boolean          @default(true)
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  store       Store            @relation(fields: [storeId], references: [id], onDelete: Cascade)
  variants    ProductVariant[]

  @@index([storeId])
}

model ProductVariant {
  id          String  @id @default(cuid())
  productId   String
  /// "M", "سوور / L", or "" for a product with one price.
  label       String  @default("")
  amountMinor Int
  currency    String  @default("IQD")
  inStock     Boolean @default(true)
  position    Int     @default(0)
  product     Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId])
}

model AutomationTemplate {
  id             String   @id @default(cuid())
  storeId        String
  name           String
  publicSamples  String[]
  thanksSamples  String[]
  dmGreeting     Boolean  @default(true)
  whatsappAlways Boolean  @default(false)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  store          Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@index([storeId])
}

/// One row per post the shop has seen; automation is on by default until activeUntil.
model PostAutomation {
  id             String   @id @default(cuid())
  storeId        String
  platform       Platform
  externalPostId String
  postCreatedAt  DateTime
  enabled        Boolean  @default(true)
  productId      String?
  templateId     String?
  activeUntil    DateTime
  createdAt      DateTime @default(now())
  store          Store    @relation(fields: [storeId], references: [id], onDelete: Cascade)

  @@unique([storeId, platform, externalPostId])
  @@index([storeId, postCreatedAt])
}

model OutboxJob {
  id            String              @id @default(cuid())
  storeId       String
  messageId     String
  kind          OutboxKind
  status        OutboxStatus        @default(PENDING)
  payload       Json
  attempts      Int                 @default(0)
  nextAttemptAt DateTime            @default(now())
  sentId        String?
  /// Private replies: the buyer's messaging id Meta returns. DM jobs: the target.
  recipientId   String?
  lastError     String?
  createdAt     DateTime            @default(now())
  updatedAt     DateTime            @updatedAt
  store         Store               @relation(fields: [storeId], references: [id], onDelete: Cascade)
  message       ConversationMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@unique([messageId, kind])
  @@index([status, nextAttemptAt])
  @@index([storeId, recipientId])
  @@index([storeId, updatedAt])
}

/// A thread the merchant answered by hand: automation stays out of it.
model ThreadPause {
  id        String   @id @default(cuid())
  tenantId  String
  platform  Platform
  /// Comment threads: the comment id. DMs: the buyer's messaging id.
  threadKey String
  createdAt DateTime @default(now())

  @@unique([tenantId, platform, threadKey])
}
```

- [ ] **Step 2: Replace the `ConversationMessage` model**

Replace the whole `model ConversationMessage { ... }` block with:

```prisma
model ConversationMessage {
  id                String           @id @default(cuid())
  /// Operator-dashboard rows only; shop rows use storeId.
  projectId         String?
  storeId           String?
  platform          Platform
  channelType       ChannelType
  direction         MessageDirection
  externalThreadId  String?
  externalMessageId String?
  authorHandle      String?
  authorName        String?
  /// Platform user id of the author (comment) or sender (DM).
  authorId          String?
  parentCommentId   String?
  content           String?
  audioUrl          String?
  transcript        String?
  status            MessageStatus    @default(RECEIVED)
  generatedReply    String?
  reasoning         String?
  commentType       String?
  intent            String?
  language          String?
  confidence        Float?
  outcome           MessageOutcome?
  /// Why it was skipped or flagged; non-null means "needs you" in the inbox.
  outcomeReason     String?
  boundProductId    String?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt
  project           Project?         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  store             Store?           @relation(fields: [storeId], references: [id], onDelete: Cascade)
  jobs              OutboxJob[]

  @@unique([storeId, externalMessageId])
  @@index([platform, channelType])
  @@index([projectId])
  @@index([storeId, authorId])
}
```

- [ ] **Step 3: Add the back-relation on `Tenant`**

In `model Tenant`, directly under the line `  oauthCredentials      OAuthCredential[]`, add:

```prisma
  stores                Store[]
```

- [ ] **Step 4: Push and regenerate**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema", then "Generated Prisma Client". Prisma should not warn about data loss, because every change is additive or relaxes a NOT NULL. If it does warn, STOP and report instead of accepting.

- [ ] **Step 5: Type-check the existing code**

Run: `npx tsc --noEmit -p .`
Expected: exit 0. `projectId` became optional, but existing code only filters by it and creates rows with it, so nothing should break. If an error names a read of `message.projectId`, narrow it with `if (!msg.projectId) continue;` at that spot.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Add the shop automation tables

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Plans, the digit guard, money

**Files:**
- Create: `src/lib/shop/plans.ts`, `src/lib/shop/digits.ts`, `src/lib/shop/money.ts`
- Test: `tests/shop/basics.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/shop/basics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dailyCap, SHOP_LIMITS } from "@/lib/shop/plans";
import { hasDigit } from "@/lib/shop/digits";
import { formatMoney } from "@/lib/shop/money";

describe("shop plans", () => {
  it("automates the newest 3 / 25 / all posts", () => {
    expect(SHOP_LIMITS.FREE.posts).toBe(3);
    expect(SHOP_LIMITS.MERCHANT.posts).toBe(25);
    expect(SHOP_LIMITS.PRO.posts).toBeNull();
  });
  it("lets a store cap itself below its plan, never above", () => {
    expect(dailyCap("FREE", null)).toBe(100);
    expect(dailyCap("MERCHANT", 200)).toBe(200);
    expect(dailyCap("FREE", 500)).toBe(100);
  });
});

describe("hasDigit", () => {
  it("finds Western, Arabic-Indic and Persian digits", () => {
    expect(hasDigit("25 هەزار")).toBe(true);
    expect(hasDigit("٢٥ هەزار")).toBe(true);
    expect(hasDigit("۲۵")).toBe(true);
  });
  it("passes text without numbers", () => {
    expect(hasDigit("نرخی چەندە؟")).toBe(false);
    expect(hasDigit("زۆر سوپاس 🌷")).toBe(false);
  });
});

describe("formatMoney", () => {
  it("writes IQD without decimals", () => {
    expect(formatMoney(25000, "IQD", "en")).toBe("25,000 IQD");
    expect(formatMoney(25000, "IQD", "ckb")).toMatch(/^٢٥.٠٠٠ د\.ع$/);
    expect(formatMoney(25000, "IQD", "kmr")).toMatch(/^٢٥.٠٠٠ د\.ع$/);
  });
  it("writes USD with cents only when there are cents", () => {
    expect(formatMoney(1999, "USD", "en")).toBe("$19.99");
    expect(formatMoney(2000, "USD", "en")).toBe("$20");
    expect(formatMoney(1250, "USD", "ar")).toMatch(/^١٢.٥٠ \$$/);
  });
  it("uses Western digits for Kurdish in Latin letters", () => {
    expect(formatMoney(5000, "IQD", "ku_latn")).toBe("5,000 IQD");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/basics.test.ts`
Expected: FAIL — cannot resolve `@/lib/shop/plans`.

- [ ] **Step 3: Implement**

`src/lib/shop/plans.ts`:

```ts
export type StorePlan = "FREE" | "MERCHANT" | "PRO";

export interface ShopLimits {
  /** How many of the newest posts are automated; null means all. */
  posts: number | null;
  repliesPerDay: number;
  aiVaryPerMonth: number;
}

export const SHOP_LIMITS: Record<StorePlan, ShopLimits> = {
  FREE: { posts: 3, repliesPerDay: 100, aiVaryPerMonth: 30 },
  MERCHANT: { posts: 25, repliesPerDay: 1000, aiVaryPerMonth: 500 },
  PRO: { posts: null, repliesPerDay: 5000, aiVaryPerMonth: 3000 },
};

/** The store's own cap applies when it is lower than the plan's. */
export function dailyCap(plan: StorePlan, storeCap: number | null): number {
  const planCap = SHOP_LIMITS[plan].repliesPerDay;
  return storeCap != null && storeCap < planCap ? storeCap : planCap;
}
```

`src/lib/shop/digits.ts`:

```ts
/** Western 0-9, Arabic-Indic ٠-٩ and Extended Arabic-Indic (Persian) ۰-۹. */
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9]/;

/** The guard that keeps AI-written text free of prices, sizes and phone numbers. */
export function hasDigit(text: string): boolean {
  return DIGIT.test(text);
}
```

`src/lib/shop/money.ts`:

```ts
/** Languages the shop answers in: Sorani, Badini (Arabic script), Arabic, Kurdish in Latin letters, English. */
export type Lang = "ckb" | "kmr" | "ar" | "ku_latn" | "en";
export const LANGS: readonly Lang[] = ["ckb", "kmr", "ar", "ku_latn", "en"];

const EXPONENT: Record<string, number> = { IQD: 0, USD: 2 };
const ARABIC_SCRIPT = new Set<Lang>(["ckb", "kmr", "ar"]);

export function exponentOf(currency: string): number {
  return EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Arabic-Indic digits for Arabic-script languages, Western digits otherwise; decimals only when there are some. */
export function formatMoney(amountMinor: number, currency: string, lang: Lang): string {
  const cur = currency.toUpperCase();
  const exp = exponentOf(cur);
  const value = amountMinor / 10 ** exp;
  const arabic = ARABIC_SCRIPT.has(lang);
  const whole = Number.isInteger(value);
  const n = new Intl.NumberFormat(arabic ? "ar-IQ" : "en-US", {
    numberingSystem: arabic ? "arab" : "latn",
    minimumFractionDigits: whole ? 0 : exp,
    maximumFractionDigits: exp,
  }).format(value);
  if (cur === "USD") return arabic ? `${n} $` : `$${n}`;
  if (cur === "IQD") return arabic ? `${n} د.ع` : `${n} IQD`;
  return `${n} ${cur}`;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/basics.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/plans.ts src/lib/shop/digits.ts src/lib/shop/money.ts tests/shop/basics.test.ts
git commit -m "Add shop plan limits, the digit guard and money formatting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Webhook parsing

**Files:**
- Create: `src/lib/shop/webhook-parse.ts`
- Test: `tests/shop/webhook-parse.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseEntry } from "@/lib/shop/webhook-parse";

const fbComment = (value: Record<string, unknown>) => ({ id: "PAGE", changes: [{ field: "feed", value }] });

describe("parseEntry — Facebook", () => {
  it("reads a new top-level comment", () => {
    const ev = parseEntry("page", fbComment({
      item: "comment", verb: "add", comment_id: "P_1_C1", post_id: "P_1", parent_id: "P_1",
      from: { id: "U1", name: "Aram" }, message: "چەندە؟",
    }));
    expect(ev).toEqual([{
      kind: "comment", platform: "META_FACEBOOK", accountId: "PAGE", commentId: "P_1_C1", postId: "P_1",
      parentCommentId: null, authorId: "U1", authorName: "Aram", text: "چەندە؟",
    }]);
  });
  it("keeps the parent of a reply to a comment", () => {
    const [ev] = parseEntry("page", fbComment({
      item: "comment", verb: "add", comment_id: "P_1_C2", post_id: "P_1", parent_id: "P_1_C1", from: { id: "U2" }, message: "منیش",
    }));
    expect(ev).toMatchObject({ parentCommentId: "P_1_C1", authorName: null });
  });
  it("ignores edits, removals, reactions and posts", () => {
    for (const value of [
      { item: "comment", verb: "edited", comment_id: "C", post_id: "P" },
      { item: "comment", verb: "remove", comment_id: "C", post_id: "P" },
      { item: "reaction", verb: "add", post_id: "P" },
      { item: "status", verb: "add", post_id: "P" },
    ]) expect(parseEntry("page", fbComment(value))).toEqual([]);
  });
});

describe("parseEntry — Instagram", () => {
  it("reads a comment and a reply", () => {
    const ev = parseEntry("instagram", { id: "IG", changes: [
      { field: "comments", value: { id: "C1", text: "price?", from: { id: "S1", username: "shilan" }, media: { id: "M1" } } },
      { field: "comments", value: { id: "C2", text: "😍", from: { id: "S2", username: "dara" }, media: { id: "M1" }, parent_id: "C1" } },
    ] });
    expect(ev).toEqual([
      { kind: "comment", platform: "META_INSTAGRAM", accountId: "IG", commentId: "C1", postId: "M1", parentCommentId: null, authorId: "S1", authorName: "shilan", text: "price?" },
      { kind: "comment", platform: "META_INSTAGRAM", accountId: "IG", commentId: "C2", postId: "M1", parentCommentId: "C1", authorId: "S2", authorName: "dara", text: "😍" },
    ]);
  });
});

describe("parseEntry — messages", () => {
  it("reads a DM and skips echoes and our own sends", () => {
    const ev = parseEntry("instagram", { id: "IG", messaging: [
      { sender: { id: "S1" }, message: { mid: "m1", text: "قیاسی L هەیە؟" } },
      { sender: { id: "S1" }, message: { mid: "m2", text: "x", is_echo: true } },
      { sender: { id: "IG" }, message: { mid: "m3", text: "ours" } },
    ] });
    expect(ev).toEqual([{ kind: "dm", platform: "META_INSTAGRAM", accountId: "IG", messageId: "m1", senderId: "S1", text: "قیاسی L هەیە؟" }]);
  });
  it("returns nothing for an entry without an id", () => {
    expect(parseEntry("page", { changes: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/webhook-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/webhook-parse.ts`:

```ts
export type MetaPlatform = "META_FACEBOOK" | "META_INSTAGRAM";

export type ShopEvent =
  | {
      kind: "comment";
      platform: MetaPlatform;
      accountId: string;
      commentId: string;
      postId: string;
      parentCommentId: string | null;
      authorId: string | null;
      authorName: string | null;
      text: string;
    }
  | { kind: "dm"; platform: MetaPlatform; accountId: string; messageId: string; senderId: string; text: string };

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * One webhook entry → the events the shop acts on. Only new comments (Facebook
 * `feed` with verb "add", Instagram `comments`) and inbound DMs; edits,
 * removals, reactions, echoes and our own messages are dropped here.
 */
export function parseEntry(object: string | undefined, entry: unknown): ShopEvent[] {
  const e = (entry ?? {}) as Obj;
  const accountId = str(e.id);
  if (!accountId) return [];
  const platform: MetaPlatform = object === "page" ? "META_FACEBOOK" : "META_INSTAGRAM";
  const out: ShopEvent[] = [];

  for (const change of Array.isArray(e.changes) ? (e.changes as Obj[]) : []) {
    const v = (change?.value ?? {}) as Obj;
    const from = (v.from ?? {}) as Obj;
    if (platform === "META_FACEBOOK") {
      if (change.field !== "feed" || v.item !== "comment" || v.verb !== "add") continue;
      const commentId = str(v.comment_id);
      const postId = str(v.post_id);
      if (!commentId || !postId) continue;
      const parent = str(v.parent_id);
      out.push({
        kind: "comment", platform, accountId, commentId, postId,
        parentCommentId: parent && parent !== postId ? parent : null,
        authorId: str(from.id), authorName: str(from.name), text: text(v.message),
      });
    } else {
      if (change.field !== "comments") continue;
      const commentId = str(v.id);
      const postId = str(((v.media ?? {}) as Obj).id);
      if (!commentId || !postId) continue;
      out.push({
        kind: "comment", platform, accountId, commentId, postId,
        parentCommentId: str(v.parent_id),
        authorId: str(from.id), authorName: str(from.username), text: text(v.text),
      });
    }
  }

  for (const m of Array.isArray(e.messaging) ? (e.messaging as Obj[]) : []) {
    const msg = (m?.message ?? {}) as Obj;
    const senderId = str(((m?.sender ?? {}) as Obj).id);
    const messageId = str(msg.mid);
    if (!messageId || !senderId || msg.is_echo === true || senderId === accountId) continue;
    out.push({ kind: "dm", platform, accountId, messageId, senderId, text: text(msg.text) });
  }
  return out;
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/webhook-parse.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/webhook-parse.ts tests/shop/webhook-parse.test.ts
git commit -m "Parse Meta webhook entries into shop events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The gate

**Files:**
- Create: `src/lib/shop/gate.ts`
- Test: `tests/shop/gate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { gate, gateDm, type GateInput } from "@/lib/shop/gate";

const now = new Date("2026-10-01T12:00:00Z");
const base: GateInput = {
  now,
  store: { automationEnabled: true, pausedReason: null, stopBefore: null },
  self: { ids: ["PAGE"], username: "myshop" },
  author: { id: "U1", name: "Aram" },
  post: { enabled: true, activeUntil: new Date("2026-10-20T00:00:00Z"), postCreatedAt: new Date("2026-09-25T00:00:00Z") },
  newerAutomatedPosts: 0,
  postSlots: 3,
  repliedToAuthorOnPostToday: false,
  threadPaused: false,
  sentToday: 0,
  dailyCap: 100,
};

describe("gate", () => {
  it("lets an ordinary comment through", () => {
    expect(gate(base)).toEqual({ ok: true });
  });
  it("never answers the store itself, by id or by username", () => {
    expect(gate({ ...base, author: { id: "PAGE", name: null } })).toEqual({ ok: false, reason: "self" });
    expect(gate({ ...base, author: { id: "X", name: "MyShop" } })).toEqual({ ok: false, reason: "self" });
  });
  it("respects the store switches", () => {
    expect(gate({ ...base, store: { ...base.store, automationEnabled: false } })).toEqual({ ok: false, reason: "store_off" });
    expect(gate({ ...base, store: { ...base.store, pausedReason: "token" } })).toEqual({ ok: false, reason: "store_paused" });
  });
  it("respects the post: missing, off, expired, before the stop date", () => {
    expect(gate({ ...base, post: null })).toEqual({ ok: false, reason: "no_post" });
    expect(gate({ ...base, post: { ...base.post!, enabled: false } })).toEqual({ ok: false, reason: "post_off" });
    expect(gate({ ...base, post: { ...base.post!, activeUntil: now } })).toEqual({ ok: false, reason: "post_expired" });
    expect(gate({ ...base, store: { ...base.store, stopBefore: new Date("2026-09-26T00:00:00Z") } })).toEqual({ ok: false, reason: "post_before_stop" });
  });
  it("only automates the newest N posts of the plan", () => {
    expect(gate({ ...base, newerAutomatedPosts: 2 })).toEqual({ ok: true });
    expect(gate({ ...base, newerAutomatedPosts: 3 })).toEqual({ ok: false, reason: "post_slots" });
    expect(gate({ ...base, postSlots: null, newerAutomatedPosts: 999 })).toEqual({ ok: true });
  });
  it("stops for a paused thread, a repeat author and the daily cap", () => {
    expect(gate({ ...base, threadPaused: true })).toEqual({ ok: false, reason: "thread_paused" });
    expect(gate({ ...base, repliedToAuthorOnPostToday: true })).toEqual({ ok: false, reason: "author_limit" });
    expect(gate({ ...base, sentToday: 100 })).toEqual({ ok: false, reason: "daily_cap" });
  });
});

describe("gateDm", () => {
  const dm = { store: base.store, threadPaused: false, sentToday: 0, dailyCap: 100 };
  it("lets a DM through and applies the same stops", () => {
    expect(gateDm(dm)).toEqual({ ok: true });
    expect(gateDm({ ...dm, store: { ...dm.store, automationEnabled: false } })).toEqual({ ok: false, reason: "store_off" });
    expect(gateDm({ ...dm, threadPaused: true })).toEqual({ ok: false, reason: "thread_paused" });
    expect(gateDm({ ...dm, sentToday: 100 })).toEqual({ ok: false, reason: "daily_cap" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/gate.ts`:

```ts
export type GateReason =
  | "self" | "store_off" | "store_paused" | "no_post" | "post_off" | "post_expired"
  | "post_before_stop" | "post_slots" | "thread_paused" | "author_limit" | "daily_cap";

export type GateResult = { ok: true } | { ok: false; reason: GateReason };

interface StoreSwitches {
  automationEnabled: boolean;
  pausedReason: string | null;
  stopBefore: Date | null;
}

export interface GateInput {
  now: Date;
  store: StoreSwitches;
  /** The store's own Page / Instagram ids and Instagram username. */
  self: { ids: string[]; username: string | null };
  author: { id: string | null; name: string | null };
  post: { enabled: boolean; activeUntil: Date; postCreatedAt: Date } | null;
  /** Enabled, unexpired automated posts of this store that are newer than this one. */
  newerAutomatedPosts: number;
  /** The plan's post slots; null means every post. */
  postSlots: number | null;
  repliedToAuthorOnPostToday: boolean;
  threadPaused: boolean;
  sentToday: number;
  dailyCap: number;
}

const no = (reason: GateReason): GateResult => ({ ok: false, reason });

/** Whether a comment may be automated. The self check comes first: the shop must never answer itself. */
export function gate(i: GateInput): GateResult {
  const selfName = i.self.username?.toLowerCase();
  if ((i.author.id && i.self.ids.includes(i.author.id)) || (selfName && i.author.name?.toLowerCase() === selfName)) return no("self");
  if (!i.store.automationEnabled) return no("store_off");
  if (i.store.pausedReason) return no("store_paused");
  if (!i.post) return no("no_post");
  if (!i.post.enabled) return no("post_off");
  if (i.post.activeUntil.getTime() <= i.now.getTime()) return no("post_expired");
  if (i.store.stopBefore && i.post.postCreatedAt < i.store.stopBefore) return no("post_before_stop");
  if (i.postSlots != null && i.newerAutomatedPosts >= i.postSlots) return no("post_slots");
  if (i.threadPaused) return no("thread_paused");
  if (i.repliedToAuthorOnPostToday) return no("author_limit");
  if (i.sentToday >= i.dailyCap) return no("daily_cap");
  return { ok: true };
}

export interface DmGateInput {
  store: StoreSwitches;
  threadPaused: boolean;
  sentToday: number;
  dailyCap: number;
}

export function gateDm(i: DmGateInput): GateResult {
  if (!i.store.automationEnabled) return no("store_off");
  if (i.store.pausedReason) return no("store_paused");
  if (i.threadPaused) return no("thread_paused");
  if (i.sentToday >= i.dailyCap) return no("daily_cap");
  return { ok: true };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/gate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/gate.ts tests/shop/gate.test.ts
git commit -m "Add the shop automation gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Policy

**Files:**
- Create: `src/lib/shop/policy.ts`
- Test: `tests/shop/policy.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { decideComment, decideDm, type Classification } from "@/lib/shop/policy";

const c = (type: Classification["type"], intent: Classification["intent"] = "none", confidence = 0.9): Classification => ({ type, intent, language: "ckb", confidence });
const ctx = { hasProduct: true, hasDefaultDm: false, likeComments: true, autoHideSpam: false, isFacebook: true, whatsappAlways: false, canPrivateReply: true };

describe("decideComment", () => {
  it("answers a question publicly and privately with the card, and likes it on Facebook", () => {
    expect(decideComment(c("QUESTION", "price"), ctx)).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "PRIVATE_REPLY", content: "card", whatsapp: false }, { kind: "LIKE" }],
      flag: null,
    });
  });
  it("adds WhatsApp for an order, or always when the template says so", () => {
    expect(decideComment(c("ORDER"), ctx).actions).toContainEqual({ kind: "PRIVATE_REPLY", content: "card", whatsapp: true });
    expect(decideComment(c("QUESTION", "price"), { ...ctx, whatsappAlways: true }).actions).toContainEqual({ kind: "PRIVATE_REPLY", content: "card", whatsapp: true });
  });
  it("falls back to the default DM, or flags the post when there is none", () => {
    expect(decideComment(c("QUESTION", "price"), { ...ctx, hasProduct: false, hasDefaultDm: true })).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false }, { kind: "LIKE" }],
      flag: null,
    });
    expect(decideComment(c("QUESTION", "price"), { ...ctx, hasProduct: false })).toEqual({
      actions: [{ kind: "PUBLIC_REPLY", style: "answer" }, { kind: "LIKE" }],
      flag: "no_product",
    });
  });
  it("skips the private reply when it is no longer allowed, and likes only on Facebook", () => {
    expect(decideComment(c("QUESTION", "price"), { ...ctx, canPrivateReply: false, isFacebook: false }).actions).toEqual([{ kind: "PUBLIC_REPLY", style: "answer" }]);
  });
  it("thanks praise", () => {
    expect(decideComment(c("PRAISE"), ctx)).toEqual({ actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, { kind: "LIKE" }], flag: null });
  });
  it("stays silent and flags negotiation, complaints and anything else", () => {
    expect(decideComment(c("NEGOTIATION"), ctx)).toEqual({ actions: [], flag: "negotiation" });
    expect(decideComment(c("COMPLAINT"), ctx)).toEqual({ actions: [], flag: "complaint" });
    expect(decideComment(c("OTHER"), ctx)).toEqual({ actions: [], flag: "other" });
  });
  it("hides spam and abuse only when the store asked for it", () => {
    expect(decideComment(c("SPAM"), ctx)).toEqual({ actions: [], flag: "spam" });
    expect(decideComment(c("ABUSE"), { ...ctx, autoHideSpam: true })).toEqual({ actions: [{ kind: "HIDE" }], flag: "abuse" });
  });
  it("does nothing on low confidence", () => {
    expect(decideComment(c("QUESTION", "price", 0.4), ctx)).toEqual({ actions: [], flag: "low_confidence" });
  });
});

describe("decideDm", () => {
  const dctx = { boundProduct: true, firstReply: false, hasPhotos: true };
  it("sends photos on the first reply, then answers product questions", () => {
    expect(decideDm(c("QUESTION", "size_colour"), { ...dctx, firstReply: true })).toEqual({
      actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "size_colour", whatsapp: false }],
      flag: null,
    });
  });
  it("answers an order with WhatsApp", () => {
    expect(decideDm(c("ORDER", "none"), dctx)).toEqual({ actions: [{ kind: "DM_ANSWER", intent: "none", whatsapp: true }], flag: null });
  });
  it("flags what the card cannot answer", () => {
    expect(decideDm(c("QUESTION", "address"), dctx)).toEqual({ actions: [], flag: "needs_you" });
    expect(decideDm(c("NEGOTIATION"), dctx)).toEqual({ actions: [], flag: "negotiation" });
    expect(decideDm(null, dctx)).toEqual({ actions: [], flag: "unclear" });
  });
  it("lets thanks pass silently", () => {
    expect(decideDm(c("PRAISE"), dctx)).toEqual({ actions: [], flag: null });
  });
  it("flags every DM with no product behind it", () => {
    expect(decideDm(c("QUESTION", "price"), { ...dctx, boundProduct: false })).toEqual({ actions: [], flag: "no_product" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/policy.ts`:

```ts
import type { Lang } from "./money";

export type CommentType = "QUESTION" | "ORDER" | "PRAISE" | "NEGOTIATION" | "COMPLAINT" | "ABUSE" | "SPAM" | "OTHER";
export type Intent = "price" | "delivery" | "size_colour" | "address" | "hours" | "availability" | "none";
export const COMMENT_TYPES: readonly CommentType[] = ["QUESTION", "ORDER", "PRAISE", "NEGOTIATION", "COMPLAINT", "ABUSE", "SPAM", "OTHER"];
export const INTENTS: readonly Intent[] = ["price", "delivery", "size_colour", "address", "hours", "availability", "none"];

export interface Classification {
  type: CommentType;
  intent: Intent;
  language: Lang;
  confidence: number;
}

/** Below this the shop stays silent and asks the merchant. */
export const MIN_CONFIDENCE = 0.6;

export type CommentAction =
  | { kind: "PUBLIC_REPLY"; style: "answer" | "thanks" }
  | { kind: "PRIVATE_REPLY"; content: "card" | "default_dm"; whatsapp: boolean }
  | { kind: "LIKE" }
  | { kind: "HIDE" };

export interface CommentDecision {
  actions: CommentAction[];
  /** Non-null: the merchant should look at this one ("needs you"). */
  flag: string | null;
}

export interface CommentContext {
  hasProduct: boolean;
  hasDefaultDm: boolean;
  likeComments: boolean;
  autoHideSpam: boolean;
  isFacebook: boolean;
  whatsappAlways: boolean;
  /** Meta allows one private reply per comment, within 7 days of it. */
  canPrivateReply: boolean;
}

export function decideComment(c: Classification, ctx: CommentContext): CommentDecision {
  if (c.confidence < MIN_CONFIDENCE) return { actions: [], flag: "low_confidence" };
  const like: CommentAction[] = ctx.isFacebook && ctx.likeComments ? [{ kind: "LIKE" }] : [];

  if (c.type === "QUESTION" || c.type === "ORDER") {
    const actions: CommentAction[] = [{ kind: "PUBLIC_REPLY", style: "answer" }];
    let flag: string | null = null;
    if (ctx.canPrivateReply) {
      if (ctx.hasProduct) {
        actions.push({ kind: "PRIVATE_REPLY", content: "card", whatsapp: c.type === "ORDER" || ctx.whatsappAlways });
      } else if (ctx.hasDefaultDm) {
        actions.push({ kind: "PRIVATE_REPLY", content: "default_dm", whatsapp: false });
      } else {
        flag = "no_product";
      }
    }
    return { actions: [...actions, ...like], flag };
  }
  if (c.type === "PRAISE") return { actions: [{ kind: "PUBLIC_REPLY", style: "thanks" }, ...like], flag: null };
  if (c.type === "SPAM" || c.type === "ABUSE") {
    return { actions: ctx.autoHideSpam ? [{ kind: "HIDE" }] : [], flag: c.type.toLowerCase() };
  }
  return { actions: [], flag: c.type.toLowerCase() };
}

export type DmAction = { kind: "DM_PHOTOS" } | { kind: "DM_ANSWER"; intent: Intent; whatsapp: boolean };

export interface DmContext {
  /** The thread began with a product card, so we know what the buyer is asking about. */
  boundProduct: boolean;
  /** No photos have been sent to this buyer yet. */
  firstReply: boolean;
  hasPhotos: boolean;
}

const CARD_ANSWERS: readonly Intent[] = ["price", "delivery", "size_colour", "availability"];

export function decideDm(c: Classification | null, ctx: DmContext): { actions: DmAction[]; flag: string | null } {
  if (!ctx.boundProduct) return { actions: [], flag: "no_product" };
  const photos: DmAction[] = ctx.firstReply && ctx.hasPhotos ? [{ kind: "DM_PHOTOS" }] : [];
  if (!c) return { actions: photos, flag: "unclear" };
  if (c.confidence < MIN_CONFIDENCE) return { actions: photos, flag: "low_confidence" };
  if (c.type === "ORDER") return { actions: [...photos, { kind: "DM_ANSWER", intent: c.intent, whatsapp: true }], flag: null };
  if (c.type === "QUESTION") {
    return CARD_ANSWERS.includes(c.intent)
      ? { actions: [...photos, { kind: "DM_ANSWER", intent: c.intent, whatsapp: false }], flag: null }
      : { actions: photos, flag: "needs_you" };
  }
  if (c.type === "PRAISE") return { actions: photos, flag: null };
  return { actions: photos, flag: c.type.toLowerCase() };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/policy.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/policy.ts tests/shop/policy.test.ts
git commit -m "Add the shop reply policy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Composition

**Files:**
- Create: `src/lib/shop/compose.ts`
- Test: `tests/shop/compose.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { answerText, COPY, DEFAULT_SAMPLES, dmText, fbCardElements, truncate, waText, type CardProduct, type CardStore } from "@/lib/shop/compose";
import { LANGS } from "@/lib/shop/money";
import { hasDigit } from "@/lib/shop/digits";

const hoodie: CardProduct = {
  name: "Hoodie",
  photos: ["https://x/1.jpg", "https://x/2.jpg"],
  variants: [
    { label: "M", amountMinor: 25000, currency: "IQD", inStock: true },
    { label: "L", amountMinor: 27000, currency: "IQD", inStock: false },
  ],
};
const oneprice: CardProduct = { name: "Bag", photos: [], variants: [{ label: "", amountMinor: 15000, currency: "IQD", inStock: true }] };
const store: CardStore = { deliveryFeeMinor: 5000, deliveryCurrency: "IQD", deliveryTime: "1-2 days" };
const WA = "https://gituas.com/w/s?t=x";

describe("dmText", () => {
  it("lists variants, delivery and the order link", () => {
    expect(dmText({ greeting: "Hi!", product: hoodie, store, lang: "en", waUrl: WA })).toBe(
      "Hi!\nHoodie\n• M: 25,000 IQD\n• L: Sold out\nDelivery: 5,000 IQD — 1-2 days\nTo order: https://gituas.com/w/s?t=x",
    );
  });
  it("writes one price without a bullet, free delivery, and no link", () => {
    expect(dmText({ greeting: "Hi!", product: oneprice, store: { ...store, deliveryFeeMinor: 0, deliveryTime: null }, lang: "en", waUrl: null })).toBe(
      "Hi!\nBag\nPrice: 15,000 IQD\nFree delivery",
    );
  });
  it("writes Sorani with Arabic-Indic digits", () => {
    expect(dmText({ greeting: COPY.ckb.hello, product: hoodie, store, lang: "ckb", waUrl: null })).toMatch(/• M: ٢٥.٠٠٠ د\.ع/);
  });
});

describe("answerText", () => {
  it("answers price, delivery and sizes from the card", () => {
    expect(answerText("price", hoodie, store, "en", null)).toBe("Hoodie\n• M: 25,000 IQD\n• L: Sold out");
    expect(answerText("delivery", hoodie, store, "en", null)).toBe("Delivery: 5,000 IQD — 1-2 days");
    expect(answerText("size_colour", hoodie, store, "en", null)).toBe("Available: M");
  });
  it("adds the order link, and returns null when there is nothing to say", () => {
    expect(answerText("none", hoodie, store, "en", WA)).toBe("To order: https://gituas.com/w/s?t=x");
    expect(answerText("delivery", hoodie, { deliveryFeeMinor: null, deliveryCurrency: "IQD", deliveryTime: null }, "en", null)).toBeNull();
  });
});

describe("fbCardElements", () => {
  it("makes one element per variant, cycling photos, with the order button", () => {
    const els = fbCardElements(hoodie, store, "en", WA);
    expect(els).toHaveLength(2);
    expect(els[0]).toEqual({
      title: "Hoodie — M",
      subtitle: "25,000 IQD · Delivery: 5,000 IQD — 1-2 days",
      image_url: "https://x/1.jpg",
      buttons: [{ type: "web_url", url: WA, title: "Order now" }],
    });
    expect(els[1]).toMatchObject({ title: "Hoodie — L", subtitle: "Sold out · Delivery: 5,000 IQD — 1-2 days", image_url: "https://x/2.jpg" });
  });
  it("makes one element per photo for a single-price product, capped at 10", () => {
    const many = { ...oneprice, photos: Array.from({ length: 12 }, (_, i) => `https://x/${i}.jpg`) };
    const els = fbCardElements(many, store, "en", null);
    expect(els).toHaveLength(10);
    expect(els[0].buttons).toBeUndefined();
  });
  it("keeps subtitles within Meta's 80 characters", () => {
    const long = { ...store, deliveryTime: "x".repeat(200) };
    for (const el of fbCardElements(hoodie, long, "en", WA)) expect(el.subtitle!.length).toBeLessThanOrEqual(80);
  });
});

describe("helpers", () => {
  it("truncates at a word boundary with an ellipsis", () => {
    expect(truncate("short", 80)).toBe("short");
    const t = truncate("word ".repeat(30), 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t.endsWith("…")).toBe(true);
  });
  it("names the product and first in-stock price for WhatsApp", () => {
    expect(waText(hoodie, "en")).toBe("Hoodie — 25,000 IQD");
  });
  it("ships default samples and greetings for every language, none with digits", () => {
    for (const lang of LANGS) {
      expect(DEFAULT_SAMPLES.answer[lang].length).toBeGreaterThan(0);
      expect(DEFAULT_SAMPLES.thanks[lang].length).toBeGreaterThan(0);
      for (const s of [...DEFAULT_SAMPLES.answer[lang], ...DEFAULT_SAMPLES.thanks[lang], COPY[lang].hello]) expect(hasDigit(s)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/compose.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/compose.ts`:

```ts
import { formatMoney, type Lang } from "./money";
import type { Intent } from "./policy";

export interface CardVariant {
  label: string;
  amountMinor: number;
  currency: string;
  inStock: boolean;
}
export interface CardProduct {
  name: string;
  photos: string[];
  variants: CardVariant[];
}
export interface CardStore {
  deliveryFeeMinor: number | null;
  deliveryCurrency: string;
  deliveryTime: string | null;
}
export interface FbElement {
  title: string;
  subtitle?: string;
  image_url?: string;
  buttons?: { type: "web_url"; url: string; title: string }[];
}

interface Copy {
  hello: string;
  price: string;
  available: string;
  soldOut: string;
  delivery: string;
  freeDelivery: string;
  order: string;
  orderButton: string;
  comma: string;
}

/** Fixed copy per language. Numbers never come from here — only from the product and store rows. */
export const COPY: Record<Lang, Copy> = {
  ckb: { hello: "سڵاو! ئەمە زانیارییەکانە:", price: "نرخ", available: "بەردەستە", soldOut: "نەماوە", delivery: "گەیاندن", freeDelivery: "گەیاندن بەخۆڕایی", order: "بۆ داواکردن:", orderButton: "داواکردن", comma: "، " },
  kmr: { hello: "سلاڤ! ئەڤە پێزانینن:", price: "بها", available: "هەیە", soldOut: "نەمایە", delivery: "گەهاندن", freeDelivery: "گەهاندن بێ بەرامبەر", order: "بۆ داخوازکرنێ:", orderButton: "داخوازکرن", comma: "، " },
  ar: { hello: "أهلاً! هذه التفاصيل:", price: "السعر", available: "متوفر", soldOut: "نفد", delivery: "التوصيل", freeDelivery: "توصيل مجاني", order: "للطلب:", orderButton: "اطلب الآن", comma: "، " },
  ku_latn: { hello: "Silaw! Eme zanyariyekane:", price: "Nirx", available: "Berdeste", soldOut: "Nemawe", delivery: "Geyandin", freeDelivery: "Geyandin bexorayî", order: "Bo daway kirdin:", orderButton: "Daway bike", comma: ", " },
  en: { hello: "Hi! Here are the details:", price: "Price", available: "Available", soldOut: "Sold out", delivery: "Delivery", freeDelivery: "Free delivery", order: "To order:", orderButton: "Order now", comma: ", " },
};

/** Used when the store has not written its own samples yet. */
export const DEFAULT_SAMPLES: Record<"answer" | "thanks", Record<Lang, string[]>> = {
  answer: {
    ckb: ["نامەمان بۆت نارد، سەیری نامەکانت بکە 🌷", "وردەکارییەکانمان لە نامەدا بۆت نارد 🙏"],
    kmr: ["مە نامە بۆ تە هنارت، سەح نامێن خۆ بکە 🌷"],
    ar: ["أرسلنا لك التفاصيل على الخاص 🌷", "تفقد رسائلك، أرسلنا لك كل التفاصيل 🙏"],
    ku_latn: ["Nameman bot nard, seyrî nameket bike 🌷"],
    en: ["We sent you the details in a message 🌷"],
  },
  thanks: {
    ckb: ["زۆر سوپاس 🌷", "دەستت خۆش بێت 🙏"],
    kmr: ["گەلەک سوپاس 🌷"],
    ar: ["شكراً جزيلاً 🌷", "تسلم 🙏"],
    ku_latn: ["Zor spas 🌷"],
    en: ["Thank you so much 🌷"],
  },
};

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const priced = (v: CardVariant, lang: Lang) => (v.inStock ? formatMoney(v.amountMinor, v.currency, lang) : COPY[lang].soldOut);

function priceLines(p: CardProduct, lang: Lang): string[] {
  if (p.variants.length === 1 && !p.variants[0].label.trim()) return [`${COPY[lang].price}: ${priced(p.variants[0], lang)}`];
  return p.variants.map((v) => `• ${v.label}: ${priced(v, lang)}`);
}

export function deliveryLine(s: CardStore, lang: Lang): string | null {
  const c = COPY[lang];
  if (s.deliveryFeeMinor == null) return s.deliveryTime ? `${c.delivery}: ${s.deliveryTime}` : null;
  const fee = s.deliveryFeeMinor === 0 ? c.freeDelivery : `${c.delivery}: ${formatMoney(s.deliveryFeeMinor, s.deliveryCurrency, lang)}`;
  return s.deliveryTime ? `${fee} — ${s.deliveryTime}` : fee;
}

const lines = (xs: (string | null)[]) => xs.filter((l): l is string => !!l).join("\n");

/** The private reply text (Instagram, and the Facebook fallback). */
export function dmText(i: { greeting: string; product: CardProduct; store: CardStore; lang: Lang; waUrl: string | null }): string {
  return lines([i.greeting, i.product.name, ...priceLines(i.product, i.lang), deliveryLine(i.store, i.lang), i.waUrl ? `${COPY[i.lang].order} ${i.waUrl}` : null]);
}

/** A follow-up DM answer from the card, or null when the card cannot answer it. */
export function answerText(intent: Intent, p: CardProduct, s: CardStore, lang: Lang, waUrl: string | null): string | null {
  const c = COPY[lang];
  let body: string[] = [];
  if (intent === "price") body = [p.name, ...priceLines(p, lang)];
  else if (intent === "delivery") body = [deliveryLine(s, lang)].filter((l): l is string => !!l);
  else if (intent === "size_colour" || intent === "availability") {
    const labels = p.variants.filter((v) => v.inStock && v.label.trim()).map((v) => v.label);
    body = [labels.length ? `${c.available}: ${labels.join(c.comma)}` : p.variants.some((v) => v.inStock) ? c.available : c.soldOut];
  }
  if (!body.length && !waUrl) return null;
  return lines([...body, waUrl ? `${c.order} ${waUrl}` : null]);
}

/** Facebook private reply: one generic-template element per variant, or per photo for a one-price product. */
export function fbCardElements(p: CardProduct, s: CardStore, lang: Lang, waUrl: string | null): FbElement[] {
  const delivery = deliveryLine(s, lang);
  const buttons = waUrl ? [{ type: "web_url" as const, url: waUrl, title: truncate(COPY[lang].orderButton, 20) }] : undefined;
  const subtitle = (first: string) => truncate([first, delivery].filter(Boolean).join(" · "), 80) || undefined;
  const photoAt = (i: number) => (p.photos.length ? p.photos[i % p.photos.length] : undefined);
  if (p.variants.length > 1) {
    return p.variants.slice(0, 10).map((v, i) => ({ title: truncate(`${p.name} — ${v.label}`, 80), subtitle: subtitle(priced(v, lang)), image_url: photoAt(i), buttons }));
  }
  const sub = subtitle(p.variants[0] ? priced(p.variants[0], lang) : "");
  const photos: (string | undefined)[] = p.photos.length ? p.photos.slice(0, 10) : [undefined];
  return photos.map((url) => ({ title: truncate(p.name, 80), subtitle: sub, image_url: url, buttons }));
}

/** Pre-filled WhatsApp text: the product and the price the buyer was quoted. */
export function waText(p: CardProduct, lang: Lang): string {
  const v = p.variants.find((x) => x.inStock);
  return v ? `${p.name} — ${formatMoney(v.amountMinor, v.currency, lang)}` : p.name;
}
```

Note: `toEqual` treats `undefined` properties as absent, so the element objects above match the test even with `image_url: undefined`. JSON serialization drops them before they reach Meta.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/compose.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/compose.ts tests/shop/compose.test.ts
git commit -m "Compose shop replies and product cards per language

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Classify and vary (the two AI calls)

**Files:**
- Create: `src/lib/shop/classify.ts`, `src/lib/shop/vary.ts`
- Test: `tests/shop/ai.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseClassification } from "@/lib/shop/classify";
import { MAX_REPLY, varySample, type Completer } from "@/lib/shop/vary";

describe("parseClassification", () => {
  it("accepts a well-formed answer and clamps confidence", () => {
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "ckb", confidence: 1.4 })).toEqual({ type: "QUESTION", intent: "price", language: "ckb", confidence: 1 });
    expect(parseClassification({ type: "PRAISE", language: "ar", confidence: 0.8 })).toEqual({ type: "PRAISE", intent: "none", language: "ar", confidence: 0.8 });
  });
  it("rejects anything outside the labels", () => {
    expect(parseClassification({ type: "BUY", intent: "price", language: "ckb", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "colour", language: "ckb", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "fa", confidence: 0.9 })).toBeNull();
    expect(parseClassification({ type: "QUESTION", intent: "price", language: "ckb", confidence: "high" })).toBeNull();
    expect(parseClassification("QUESTION")).toBeNull();
  });
});

describe("varySample", () => {
  const says = (data: unknown): Completer => async () => data;
  it("uses the AI's rewrite when it passes the guard", async () => {
    expect(await varySample("نامەمان بۆت نارد 🌷", "ckb", says({ text: "لە نامەدا وەڵامت دەدەینەوە 🌷" }))).toEqual({ text: "لە نامەدا وەڵامت دەدەینەوە 🌷", ai: true });
  });
  it("falls back to the merchant's words on numbers, length, junk or failure", async () => {
    const sample = "نامەمان بۆت نارد 🌷";
    expect(await varySample(sample, "ckb", says({ text: "نرخ ٢٥ هەزارە" }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", says({ text: "x".repeat(MAX_REPLY + 1) }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", says({ reply: "hi" }))).toEqual({ text: sample, ai: false });
    expect(await varySample(sample, "ckb", async () => { throw new Error("down"); })).toEqual({ text: sample, ai: false });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/ai.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/shop/classify.ts`:

```ts
import { completeJson } from "@/lib/ai/provider";
import { LANGS, type Lang } from "./money";
import { COMMENT_TYPES, INTENTS, type Classification, type CommentType, type Intent } from "./policy";

export const CLASSIFY_SYSTEM = `You label comments and direct messages that buyers send to small shops in Iraqi Kurdistan on Facebook and Instagram.
Return JSON only: {"type": "...", "intent": "...", "language": "...", "confidence": 0.0-1.0}. Never write anything else.

type:
- QUESTION: asks about the product — price, size, colour, delivery, where the shop is, whether it is available. e.g. "چەندە؟", "بە چەندە", "قیاسی L هەیە؟", "بكم", "شكد السعر", "گەیاندنتان هەیە بۆ دهۆک؟", "price?"
- ORDER: wants to buy or asks how to order. e.g. "دەمەوێت", "یەکێکم بۆ بنێرە", "اريد واحد", "ez dixwazim"
- PRAISE: praise, thanks, emoji only, or tagging a friend with no question. e.g. "زۆر جوانە", "😍😍", "@aram"
- NEGOTIATION: asks for a discount or haggles. e.g. "هەرزانتری نییە؟", "خصم؟"
- COMPLAINT: a problem with an order or the shop, or doubts that the product is genuine.
- ABUSE: insults or harassment.
- SPAM: ads, links, other sellers, scams.
- OTHER: anything else.

intent — for QUESTION and ORDER only, otherwise "none": price | delivery | size_colour | address | hours | availability | none

language: ckb = Central Kurdish (Sorani) in Arabic script; kmr = Badini (Northern Kurdish) in Arabic script; ar = Arabic; ku_latn = Kurdish in Latin letters; en = English. Emoji only: "ckb".

confidence: how sure you are about "type".`;

export function parseClassification(d: unknown): Classification | null {
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  const intent = o.intent ?? "none";
  const confidence = typeof o.confidence === "number" ? o.confidence : NaN;
  if (!COMMENT_TYPES.includes(o.type as CommentType)) return null;
  if (!INTENTS.includes(intent as Intent)) return null;
  if (!LANGS.includes(o.language as Lang)) return null;
  if (!Number.isFinite(confidence)) return null;
  return { type: o.type as CommentType, intent: intent as Intent, language: o.language as Lang, confidence: Math.min(1, Math.max(0, confidence)) };
}

/** Labels only — the model never writes text for the buyer here. Null on empty input or any failure. */
export async function classifyText(text: string, ctx: { channel: "comment" | "dm"; productName?: string }): Promise<Classification | null> {
  const t = text.trim().slice(0, 600);
  if (!t) return null;
  const about = ctx.productName ? ` on a post about: ${ctx.productName.slice(0, 80)}` : "";
  const user = `${ctx.channel === "dm" ? "Direct message" : "Comment"}${about}\n"""${t}"""`;
  try {
    return (await completeJson({ system: CLASSIFY_SYSTEM, user, strength: "fast", thinking: false }, parseClassification)).data;
  } catch {
    return null;
  }
}
```

`src/lib/shop/vary.ts`:

```ts
import { completeJson, type JsonCall } from "@/lib/ai/provider";
import { hasDigit } from "./digits";
import type { Lang } from "./money";

export type Completer = (call: JsonCall) => Promise<unknown>;

export const MAX_REPLY = 300;

const LANG_NAME: Record<Lang, string> = {
  ckb: "Central Kurdish (Sorani) in Arabic script",
  kmr: "Badini (Northern Kurdish) in Arabic script",
  ar: "Iraqi Arabic",
  ku_latn: "Kurdish written in Latin letters",
  en: "English",
};

const defaultCompleter: Completer = async (call) => (await completeJson(call)).data;

/**
 * Rewrite one of the merchant's samples so repeated replies do not read as a
 * bot (and are not flagged as spam). The rewrite must pass the guard — no
 * digits, at most MAX_REPLY characters — or the sample goes out verbatim.
 */
export async function varySample(sample: string, lang: Lang, complete: Completer = defaultCompleter): Promise<{ text: string; ai: boolean }> {
  try {
    const data = await complete({
      system: `You rewrite a short reply that a shop posts on social media. Write it in ${LANG_NAME[lang]}. Keep the meaning and the warm tone, change the wording. One or two short sentences, at most one emoji. Never write any number, price, size or phone number. Return JSON {"text": "..."}.`,
      user: `"""${sample.slice(0, MAX_REPLY)}"""`,
      strength: "fast",
      thinking: false,
    });
    const out = (data as { text?: unknown } | null)?.text;
    const text = typeof out === "string" ? out.trim() : "";
    if (text && text.length <= MAX_REPLY && !hasDigit(text)) return { text, ai: true };
  } catch {
    /* the merchant's own words are always a safe answer */
  }
  return { text: sample, ai: false };
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/ai.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/classify.ts src/lib/shop/vary.ts tests/shop/ai.test.ts
git commit -m "Classify buyer messages and vary reply samples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Meta errors and the Meta client

**Files:**
- Create: `src/lib/shop/meta-errors.ts`, `src/lib/shop/meta-client.ts`
- Test: `tests/shop/meta.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffMs, classifyMetaError, retryable } from "@/lib/shop/meta-errors";
import { hideComment, likeComment, privateReply, replyToComment, sendDm, subscribeWebhooks, type StoreAccount } from "@/lib/shop/meta-client";

const err = (code: number, message = "", error_subcode?: number) => ({ error: { code, message, error_subcode } });

describe("classifyMetaError", () => {
  it("maps Graph errors to what the outbox should do", () => {
    expect(classifyMetaError(401, err(190))).toBe("token");
    expect(classifyMetaError(400, err(613))).toBe("rate");
    expect(classifyMetaError(429, {})).toBe("rate");
    expect(classifyMetaError(400, err(10, "Message sent outside of allowed window"))).toBe("window");
    expect(classifyMetaError(400, err(100, "Object does not exist", 33))).toBe("gone");
    expect(classifyMetaError(400, err(10900, "Activity already replied to"))).toBe("duplicate");
    expect(classifyMetaError(500, err(2, "Service temporarily unavailable"))).toBe("other");
  });
  it("retries only rate limits and unknown failures, with capped exponential backoff", () => {
    expect(retryable("rate")).toBe(true);
    expect(retryable("other")).toBe(true);
    expect(retryable("window")).toBe(false);
    expect(backoffMs(1)).toBe(120_000);
    expect(backoffMs(10)).toBe(3_600_000);
  });
});

describe("meta-client requests", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const reply = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }));
  afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });

  const fb: StoreAccount = { platform: "META_FACEBOOK", accountId: "PAGE", token: "T" };
  const ig: StoreAccount = { platform: "META_INSTAGRAM", accountId: "IGID", token: "T" };

  it("replies under a comment on each platform", async () => {
    reply({ id: "R1" });
    expect(await replyToComment(fb, "C1", "سوپاس")).toEqual({ ok: true, id: "R1", recipientId: null });
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/C1/comments?access_token=T");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ message: "سوپاس" });
    await replyToComment(ig, "C2", "hi");
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/C2/replies?access_token=T");
  });

  it("sends a private reply to the comment and returns the buyer's messaging id", async () => {
    reply({ recipient_id: "PSID", message_id: "M1" });
    expect(await privateReply(fb, "C1", { text: "hi" })).toEqual({ ok: true, id: "M1", recipientId: "PSID" });
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PAGE/messages?access_token=T");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ recipient: { comment_id: "C1" }, message: { text: "hi" } });
    await privateReply(ig, "C2", { text: "hi" });
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/IGID/messages?access_token=T");
  });

  it("likes and hides on Facebook, hides on Instagram, and refuses a like on Instagram", async () => {
    reply({ success: true });
    expect((await likeComment(fb, "C1")).ok).toBe(true);
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/C1/likes?access_token=T");
    await hideComment(fb, "C1");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ is_hidden: true });
    await hideComment(ig, "C2");
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ hide: true });
    expect(await likeComment(ig, "C2")).toEqual({ ok: false, failure: "gone", error: "Instagram has no API to like a comment" });
  });

  it("sends a DM with the response messaging type on Facebook", async () => {
    reply({ recipient_id: "PSID", message_id: "M2" });
    await sendDm(fb, "PSID", { text: "x" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ recipient: { id: "PSID" }, messaging_type: "RESPONSE", message: { text: "x" } });
  });

  it("subscribes the account to comment and message webhooks", async () => {
    reply({ success: true });
    await subscribeWebhooks(fb);
    expect(calls[0].url).toBe("https://graph.facebook.com/v25.0/PAGE/subscribed_apps?access_token=T&subscribed_fields=feed%2Cmessages");
    await subscribeWebhooks(ig);
    expect(calls[1].url).toBe("https://graph.instagram.com/v25.0/me/subscribed_apps?access_token=T&subscribed_fields=comments%2Cmessages");
  });

  it("turns a Graph error into a failure kind", async () => {
    reply(err(190, "Error validating access token"), 401);
    expect(await replyToComment(fb, "C1", "x")).toEqual({ ok: false, failure: "token", error: "401 190 Error validating access token" });
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/meta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/shop/meta-errors.ts`:

```ts
/** What a failed Graph call means for the outbox. */
export type MetaFailure = "token" | "rate" | "window" | "gone" | "duplicate" | "other";

export const MAX_ATTEMPTS = 5;

export function classifyMetaError(status: number, body: unknown): MetaFailure {
  const e = ((body ?? {}) as { error?: { code?: number; error_subcode?: number; message?: string } }).error ?? {};
  const msg = (e.message ?? "").toLowerCase();
  if (e.code === 190 || status === 401) return "token";
  if (e.code === 4 || e.code === 17 || e.code === 32 || e.code === 613 || status === 429) return "rate";
  if (e.code === 10900 || /already (been )?replied|only one/.test(msg)) return "duplicate";
  if (e.error_subcode === 2534022 || e.error_subcode === 2018278 || /allowed window|24 hour|outside of/.test(msg) || e.code === 10) return "window";
  if (e.error_subcode === 33 || /does not exist|cannot be loaded|unsupported (get|post) request/.test(msg)) return "gone";
  return "other";
}

export function retryable(f: MetaFailure): boolean {
  return f === "rate" || f === "other";
}

/** 2, 4, 8 … minutes, capped at an hour. */
export function backoffMs(attempt: number): number {
  return Math.min(3_600_000, 60_000 * 2 ** attempt);
}
```

`src/lib/shop/meta-client.ts`:

```ts
import { db } from "@/lib/db";
import { newestFirst, unexpired } from "@/lib/oauth/pick";
import { FB_V } from "@/lib/publishers/facebook";
import { lazyRefresh, V as IG_V } from "@/lib/publishers/instagram";
import { vaultDecrypt } from "@/lib/vault";
import type { FbElement } from "./compose";
import { classifyMetaError, type MetaFailure } from "./meta-errors";
import type { MetaPlatform } from "./webhook-parse";

export type { MetaPlatform };

export interface StoreAccount {
  platform: MetaPlatform;
  /** Facebook Page id or Instagram user id. */
  accountId: string;
  token: string;
}

export type MetaMessage =
  | { text: string }
  | { attachment: { type: "template"; payload: { template_type: "generic"; elements: FbElement[] } } }
  | { attachment: { type: "image"; payload: { url: string; is_reusable?: boolean } } };

export type SendResult = { ok: true; id: string | null; recipientId: string | null } | { ok: false; failure: MetaFailure; error: string };

const base = (acc: StoreAccount) => (acc.platform === "META_FACEBOOK" ? FB_V : IG_V);
const url = (acc: StoreAccount, path: string, extra: Record<string, string> = {}) =>
  `${base(acc)}/${path}?${new URLSearchParams({ access_token: acc.token, ...extra })}`;

async function call(target: string, init: RequestInit = {}): Promise<SendResult> {
  try {
    const res = await fetch(target, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json" } : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string }; id?: string; message_id?: string; recipient_id?: string };
    if (!res.ok || body.error) {
      const failure = classifyMetaError(res.status, body);
      return { ok: false, failure, error: `${res.status} ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.replace(/\s+/g, " ").trim().slice(0, 300) };
    }
    return { ok: true, id: body.message_id ?? body.id ?? null, recipientId: body.recipient_id ?? null };
  } catch (e) {
    return { ok: false, failure: "other", error: e instanceof Error ? e.message : "request failed" };
  }
}

const post = (target: string, body?: unknown) => call(target, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** The store's token for one platform, or null when it must be reconnected. */
export async function accountFor(store: { tenantId: string; fbPageId: string | null; igUserId: string | null }, platform: MetaPlatform): Promise<StoreAccount | null> {
  const accountId = platform === "META_FACEBOOK" ? store.fbPageId : store.igUserId;
  if (!accountId) return null;
  const cred = await db.oAuthCredential.findFirst({
    where: { tenantId: store.tenantId, provider: platform, providerAccountId: accountId, ...unexpired() },
    orderBy: newestFirst,
  });
  if (!cred) return null;
  try {
    const token = vaultDecrypt(cred.tokenEncrypted);
    if (platform === "META_FACEBOOK") return { platform, accountId, token };
    const fresh = await lazyRefresh({ id: cred.id, igUserId: accountId, token, expiresAt: cred.expiresAt });
    return { platform, accountId, token: fresh.token };
  } catch {
    return null;
  }
}

export function replyToComment(acc: StoreAccount, commentId: string, text: string): Promise<SendResult> {
  return acc.platform === "META_FACEBOOK"
    ? post(url(acc, `${commentId}/comments`), { message: text.slice(0, 8000) })
    : post(url(acc, `${commentId}/replies`), { message: text.slice(0, 2200) });
}

/** One message per comment, within 7 days of it. Instagram accepts text only. */
export function privateReply(acc: StoreAccount, commentId: string, message: MetaMessage): Promise<SendResult> {
  return post(url(acc, `${acc.accountId}/messages`), { recipient: { comment_id: commentId }, message });
}

export async function likeComment(acc: StoreAccount, commentId: string): Promise<SendResult> {
  if (acc.platform !== "META_FACEBOOK") return { ok: false, failure: "gone", error: "Instagram has no API to like a comment" };
  return post(url(acc, `${commentId}/likes`));
}

export function hideComment(acc: StoreAccount, commentId: string): Promise<SendResult> {
  return post(url(acc, commentId), acc.platform === "META_FACEBOOK" ? { is_hidden: true } : { hide: true });
}

/** Inside the 24-hour window only (the buyer wrote to us). */
export function sendDm(acc: StoreAccount, recipientId: string, message: MetaMessage): Promise<SendResult> {
  const body = acc.platform === "META_FACEBOOK" ? { recipient: { id: recipientId }, messaging_type: "RESPONSE", message } : { recipient: { id: recipientId }, message };
  return post(url(acc, `${acc.accountId}/messages`), body);
}

/** When the post was published, or null if Graph will not say. */
export async function fetchPostCreatedAt(acc: StoreAccount, postId: string): Promise<Date | null> {
  const field = acc.platform === "META_FACEBOOK" ? "created_time" : "timestamp";
  try {
    const res = await fetch(url(acc, postId, { fields: field }), { signal: AbortSignal.timeout(10_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const raw = typeof body[field] === "string" ? (body[field] as string) : null;
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/** Without this, Meta sends no comment or message webhooks for the account. */
export function subscribeWebhooks(acc: StoreAccount): Promise<SendResult> {
  return acc.platform === "META_FACEBOOK"
    ? post(url(acc, `${acc.accountId}/subscribed_apps`, { subscribed_fields: "feed,messages" }))
    : post(url(acc, "me/subscribed_apps", { subscribed_fields: "comments,messages" }));
}
```

Check before running: `src/lib/publishers/instagram.ts` must export `lazyRefresh` and `V`, and `src/lib/publishers/facebook.ts` must export `FB_V`. They do, per the file map made on 2026-09-30.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/meta.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/meta-errors.ts src/lib/shop/meta-client.ts tests/shop/meta.test.ts
git commit -m "Add the shop's Meta client and error mapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Jobs (decision → outbox payloads)

**Files:**
- Create: `src/lib/shop/jobs.ts`
- Test: `tests/shop/jobs.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { buildCommentJobs, buildDmJobs } from "@/lib/shop/jobs";

const decision = {
  actions: [
    { kind: "LIKE" as const },
    { kind: "PRIVATE_REPLY" as const, content: "card" as const, whatsapp: false },
    { kind: "PUBLIC_REPLY" as const, style: "answer" as const },
  ],
  flag: null,
};
const card = { text: "CARD TEXT", elements: [{ title: "Hoodie", subtitle: "25,000 IQD" }] };

describe("buildCommentJobs", () => {
  it("orders public reply, like, private reply; Facebook gets the template with a text fallback", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_FACEBOOK", commentId: "C1", authorName: "Aram", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs.map((j) => j.kind)).toEqual(["PUBLIC_REPLY", "LIKE", "PRIVATE_REPLY"]);
    expect(jobs[0].payload).toEqual({ commentId: "C1", text: "سوپاس" });
    expect(jobs[2].payload).toEqual({
      commentId: "C1",
      message: { attachment: { type: "template", payload: { template_type: "generic", elements: card.elements } } },
      fallbackText: "CARD TEXT",
    });
  });
  it("mentions the commenter and sends text on Instagram", () => {
    const jobs = buildCommentJobs({ decision, platform: "META_INSTAGRAM", commentId: "C1", authorName: "shilan", publicText: "سوپاس", card, defaultDm: null });
    expect(jobs[0].payload.text).toBe("@shilan سوپاس");
    expect(jobs.find((j) => j.kind === "PRIVATE_REPLY")!.payload.message).toEqual({ text: "CARD TEXT" });
  });
  it("uses the default DM, and drops jobs that have nothing to send", () => {
    const d = { actions: [{ kind: "PUBLIC_REPLY" as const, style: "answer" as const }, { kind: "PRIVATE_REPLY" as const, content: "default_dm" as const, whatsapp: false }], flag: null };
    expect(buildCommentJobs({ decision: d, platform: "META_FACEBOOK", commentId: "C1", authorName: null, publicText: null, card: null, defaultDm: " سڵاو " })).toEqual([
      { kind: "PRIVATE_REPLY", payload: { commentId: "C1", message: { text: "سڵاو" } } },
    ]);
  });
});

describe("buildDmJobs", () => {
  it("sends up to five photos first, then the answer", () => {
    const photos = Array.from({ length: 7 }, (_, i) => `https://x/${i}.jpg`);
    const jobs = buildDmJobs({ actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "price", whatsapp: false }], recipientId: "S1", photos, answerText: "25,000" });
    expect(jobs).toEqual([
      { kind: "DM_PHOTOS", payload: { recipientId: "S1", urls: photos.slice(0, 5) }, recipientId: "S1" },
      { kind: "DM_ANSWER", payload: { recipientId: "S1", message: { text: "25,000" } }, recipientId: "S1" },
    ]);
  });
  it("skips an answer with no text and photos with none to send", () => {
    expect(buildDmJobs({ actions: [{ kind: "DM_PHOTOS" }, { kind: "DM_ANSWER", intent: "hours", whatsapp: false }], recipientId: "S1", photos: [], answerText: null })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/jobs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/jobs.ts`:

```ts
import type { FbElement } from "./compose";
import type { MetaMessage, MetaPlatform } from "./meta-client";
import type { CommentDecision, DmAction } from "./policy";

export type OutboxKind = "PUBLIC_REPLY" | "PRIVATE_REPLY" | "LIKE" | "HIDE" | "DM_ANSWER" | "DM_PHOTOS";

export interface JobPayload {
  commentId?: string;
  text?: string;
  message?: MetaMessage;
  /** Facebook private reply: sent as text if the template is rejected. */
  fallbackText?: string;
  recipientId?: string;
  urls?: string[];
}

export interface JobSpec {
  kind: OutboxKind;
  payload: JobPayload;
  recipientId?: string;
}

const ORDER: OutboxKind[] = ["PUBLIC_REPLY", "LIKE", "PRIVATE_REPLY", "HIDE"];

export function buildCommentJobs(i: {
  decision: CommentDecision;
  platform: MetaPlatform;
  commentId: string;
  authorName: string | null;
  publicText: string | null;
  card: { text: string; elements: FbElement[] } | null;
  defaultDm: string | null;
}): JobSpec[] {
  const out: JobSpec[] = [];
  for (const a of i.decision.actions) {
    if (a.kind === "PUBLIC_REPLY") {
      if (!i.publicText) continue;
      const mention = i.platform === "META_INSTAGRAM" && i.authorName ? `@${i.authorName} ` : "";
      out.push({ kind: "PUBLIC_REPLY", payload: { commentId: i.commentId, text: mention + i.publicText } });
    } else if (a.kind === "LIKE" || a.kind === "HIDE") {
      out.push({ kind: a.kind, payload: { commentId: i.commentId } });
    } else if (a.content === "card" && i.card) {
      const message: MetaMessage =
        i.platform === "META_FACEBOOK" && i.card.elements.length
          ? { attachment: { type: "template", payload: { template_type: "generic", elements: i.card.elements } } }
          : { text: i.card.text };
      out.push({ kind: "PRIVATE_REPLY", payload: { commentId: i.commentId, message, fallbackText: i.card.text } });
    } else if (a.content === "default_dm" && i.defaultDm?.trim()) {
      out.push({ kind: "PRIVATE_REPLY", payload: { commentId: i.commentId, message: { text: i.defaultDm.trim() } } });
    }
  }
  return out.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
}

export function buildDmJobs(i: { actions: DmAction[]; recipientId: string; photos: string[]; answerText: string | null }): JobSpec[] {
  const out: JobSpec[] = [];
  for (const a of i.actions) {
    if (a.kind === "DM_PHOTOS" && i.photos.length) {
      out.push({ kind: "DM_PHOTOS", payload: { recipientId: i.recipientId, urls: i.photos.slice(0, 5) }, recipientId: i.recipientId });
    } else if (a.kind === "DM_ANSWER" && i.answerText) {
      out.push({ kind: "DM_ANSWER", payload: { recipientId: i.recipientId, message: { text: i.answerText } }, recipientId: i.recipientId });
    }
  }
  return out;
}
```

Note: in the test, the Facebook `PRIVATE_REPLY` payload shows `fallbackText`, while the default-DM job has none. That matches the code: only card replies carry a fallback.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run tests/shop/jobs.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/shop/jobs.ts tests/shop/jobs.test.ts
git commit -m "Turn shop decisions into outbox job payloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Stores on connect, quota, thread pause

**Files:**
- Create: `src/lib/shop/store.ts`, `src/lib/shop/quota.ts`, `src/lib/shop/pause.ts`
- Modify: `src/lib/oauth/flow.ts` (end of `saveCredential`)
- Test: `tests/shop/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { pickStoreForAccount } from "@/lib/shop/store";

const s = (id: string, fbPageId: string | null, igUserId: string | null) => ({ id, fbPageId, igUserId });

describe("pickStoreForAccount", () => {
  it("links Instagram to the tenant's only store when that store has no Instagram yet", () => {
    expect(pickStoreForAccount([s("A", "PAGE", null)], "META_INSTAGRAM")).toBe("A");
  });
  it("links a Page to the only store that has Instagram but no Page", () => {
    expect(pickStoreForAccount([s("A", null, "IG")], "META_FACEBOOK")).toBe("A");
  });
  it("creates a new store when the slot is taken or the tenant has several stores", () => {
    expect(pickStoreForAccount([s("A", "PAGE", null)], "META_FACEBOOK")).toBeNull();
    expect(pickStoreForAccount([s("A", "P1", null), s("B", "P2", null)], "META_INSTAGRAM")).toBeNull();
    expect(pickStoreForAccount([], "META_FACEBOOK")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/shop/store.ts`:

```ts
import { db } from "@/lib/db";
import { accountFor, subscribeWebhooks, type MetaPlatform } from "./meta-client";

type StoreSlots = { id: string; fbPageId: string | null; igUserId: string | null };

/**
 * Which existing store a newly connected account joins. Only a tenant with
 * exactly one store, whose slot for this platform is empty, is unambiguous;
 * anything else gets a new store (the operator can merge later).
 */
export function pickStoreForAccount(stores: StoreSlots[], platform: MetaPlatform): string | null {
  if (stores.length !== 1) return null;
  const only = stores[0];
  const free = platform === "META_FACEBOOK" ? !only.fbPageId : !only.igUserId;
  return free ? only.id : null;
}

/**
 * Called after a Page or Instagram credential is saved. It creates or links the
 * merchant's store, clears a token pause, and subscribes the account to
 * webhooks. Newsroom workspaces are skipped. It never throws into the connect
 * flow; the caller catches.
 */
export async function connectStore(tenantId: string, platform: MetaPlatform, accountId: string, accountName: string): Promise<string | null> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { kind: true } });
  if (tenant?.kind !== "MERCHANT") return null;

  const slot = platform === "META_FACEBOOK" ? { fbPageId: accountId } : { igUserId: accountId };
  const extra = platform === "META_INSTAGRAM" ? { igUsername: accountName } : {};

  let store = await db.store.findFirst({ where: slot, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } });
  if (store && store.tenantId !== tenantId) return null; // this account already runs another workspace's store
  if (!store) {
    const stores = await db.store.findMany({ where: { tenantId }, select: { id: true, fbPageId: true, igUserId: true } });
    const target = pickStoreForAccount(stores, platform);
    store = target
      ? await db.store.update({ where: { id: target }, data: { ...slot, ...extra }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } })
      : await db.store.create({ data: { tenantId, name: accountName, ...slot, ...extra }, select: { id: true, tenantId: true, fbPageId: true, igUserId: true } });
  }
  await db.store.update({ where: { id: store.id }, data: { pausedReason: null, ...extra } });

  const acc = await accountFor(store, platform);
  if (acc && (await subscribeWebhooks(acc)).ok) {
    await db.store.update({ where: { id: store.id }, data: { webhooksAt: new Date() } });
  }
  return store.id;
}
```

`src/lib/shop/quota.ts`:

```ts
import { db } from "@/lib/db";
import { monthKey } from "@/lib/billing/limits";

// Usage is keyed by a plain id string; a store id (a cuid) cannot collide with a tenant id.
const METRIC = "shop_ai_vary";

export async function aiVaryUsed(storeId: string): Promise<number> {
  const row = await db.usage.findUnique({ where: { tenantId_month_metric: { tenantId: storeId, month: monthKey(), metric: METRIC } }, select: { count: true } });
  return row?.count ?? 0;
}

export async function countAiVary(storeId: string): Promise<void> {
  const month = monthKey();
  await db.usage.upsert({
    where: { tenantId_month_metric: { tenantId: storeId, month, metric: METRIC } },
    create: { tenantId: storeId, month, metric: METRIC, count: 1 },
    update: { count: { increment: 1 } },
  });
}
```

`src/lib/shop/pause.ts`:

```ts
import { db } from "@/lib/db";
import type { MetaPlatform } from "./meta-client";

/** The merchant answered this thread by hand: automation stays out of it from now on. */
export async function pauseThread(tenantId: string, platform: MetaPlatform, threadKey: string): Promise<void> {
  await db.threadPause.upsert({
    where: { tenantId_platform_threadKey: { tenantId, platform, threadKey } },
    create: { tenantId, platform, threadKey },
    update: {},
  });
}
```

- [ ] **Step 4: Hook `connectStore` into the connect flow**

In `src/lib/oauth/flow.ts`, add the import next to the other imports at the top:

```ts
import { connectStore } from "@/lib/shop/store";
```

In `saveCredential`, directly after the `await db.auditLog.create({ ... });` call (the last statement of the function), add:

```ts
  // Shop automation: create/link the merchant's store and subscribe the account to webhooks.
  if (provider === "META_INSTAGRAM" || (provider === "META_FACEBOOK" && !account.id.startsWith("act_"))) {
    await connectStore(tenantId, provider, account.id, account.name).catch((e) =>
      console.error("[shop] store connect failed:", e instanceof Error ? e.message : "unknown error"),
    );
  }
```

- [ ] **Step 5: Run the test and the type-check**

Run: `npx vitest run tests/shop/store.test.ts && npx tsc --noEmit -p .`
Expected: PASS (3 tests), tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shop/store.ts src/lib/shop/quota.ts src/lib/shop/pause.ts src/lib/oauth/flow.ts tests/shop/store.test.ts
git commit -m "Create the merchant's store and subscribe webhooks on connect

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The outbox and the pipeline

**Files:**
- Create: `src/lib/shop/outbox.ts`, `src/lib/shop/pipeline.ts`
- Test: `tests/shop/pipeline.test.ts` (pure helpers only; the database paths are verified live in Task 14)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { jitterMs, startOfUtcDay } from "@/lib/shop/pipeline";

describe("pipeline helpers", () => {
  it("waits between 8 and 30 seconds", () => {
    expect(jitterMs(() => 0)).toBe(8_000);
    expect(jitterMs(() => 0.9999)).toBeLessThanOrEqual(30_000);
  });
  it("counts the day in UTC", () => {
    expect(startOfUtcDay(new Date("2026-10-01T23:30:00+03:00")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run tests/shop/pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/shop/outbox.ts`:

```ts
import { db } from "@/lib/db";
import type { JobPayload, OutboxKind } from "./jobs";
import { accountFor, hideComment, likeComment, privateReply, replyToComment, sendDm, type MetaPlatform, type SendResult, type StoreAccount } from "./meta-client";
import { backoffMs, MAX_ATTEMPTS, retryable } from "./meta-errors";

const HOUR = 3_600_000;

async function send(acc: StoreAccount, kind: OutboxKind, p: JobPayload): Promise<SendResult> {
  switch (kind) {
    case "PUBLIC_REPLY":
      return replyToComment(acc, p.commentId!, p.text!);
    case "LIKE":
      return likeComment(acc, p.commentId!);
    case "HIDE":
      return hideComment(acc, p.commentId!);
    case "PRIVATE_REPLY": {
      const r = await privateReply(acc, p.commentId!, p.message!);
      // A rejected Facebook template is resent as plain text; "duplicate"/"window" are final.
      if (!r.ok && r.failure === "other" && p.fallbackText && !("text" in p.message!)) return privateReply(acc, p.commentId!, { text: p.fallbackText });
      return r;
    }
    case "DM_ANSWER":
      return sendDm(acc, p.recipientId!, p.message!);
    case "DM_PHOTOS": {
      let last: SendResult = { ok: true, id: null, recipientId: p.recipientId ?? null };
      for (const u of p.urls ?? []) {
        last = await sendDm(acc, p.recipientId!, { attachment: { type: "image", payload: { url: u, is_reusable: true } } });
        if (!last.ok) return last;
      }
      return last;
    }
  }
}

/** Send one job and record what happened. Safe to call twice: only PENDING jobs are sent. */
export async function runJob(jobId: string): Promise<void> {
  const job = await db.outboxJob.findUnique({
    where: { id: jobId },
    include: { store: { select: { id: true, tenantId: true, fbPageId: true, igUserId: true } }, message: { select: { platform: true } } },
  });
  if (!job || job.status !== "PENDING") return;

  const acc = await accountFor(job.store, job.message.platform as MetaPlatform);
  if (!acc) {
    await db.store.update({ where: { id: job.storeId }, data: { pausedReason: "token" } });
    await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + HOUR), lastError: "no usable credential" } });
    return;
  }

  const r = await send(acc, job.kind, job.payload as JobPayload);
  if (r.ok) {
    await db.outboxJob.update({ where: { id: job.id }, data: { status: "SENT", sentId: r.id, recipientId: r.recipientId ?? job.recipientId, lastError: null, attempts: { increment: 1 } } });
    return;
  }
  if (r.failure === "token") {
    await db.store.update({ where: { id: job.storeId }, data: { pausedReason: "token" } });
    await db.outboxJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(Date.now() + HOUR), lastError: r.error } });
    return;
  }
  if (!retryable(r.failure)) {
    await db.outboxJob.update({ where: { id: job.id }, data: { status: "SKIPPED", attempts: { increment: 1 }, lastError: `${r.failure}: ${r.error}`.slice(0, 300) } });
    return;
  }
  const attempts = job.attempts + 1;
  await db.outboxJob.update({
    where: { id: job.id },
    data: attempts >= MAX_ATTEMPTS
      ? { status: "FAILED", attempts, lastError: r.error }
      : { attempts, nextAttemptAt: new Date(Date.now() + backoffMs(attempts)), lastError: r.error },
  });
}
```

- [ ] **Step 4: Implement** `src/lib/shop/pipeline.ts`:

```ts
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
import { decideComment, decideDm } from "./policy";
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
  for (const id of jobIds) await runJob(id);
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

async function createJobs(storeId: string, messageId: string, specs: JobSpec[]): Promise<string[]> {
  const ids: string[] = [];
  for (const s of specs) {
    const job = await db.outboxJob.upsert({
      where: { messageId_kind: { messageId, kind: s.kind } },
      create: { storeId, messageId, kind: s.kind, payload: s.payload as Prisma.InputJsonValue, recipientId: s.recipientId ?? null },
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
    self: { ids: [store.fbPageId, store.igUserId].filter((x): x is string => !!x), username: store.igUsername },
    author: { id: msg.authorId, name: msg.authorHandle },
    post,
    newerAutomatedPosts: newer,
    postSlots: SHOP_LIMITS[plan].posts,
    repliedToAuthorOnPostToday: repliedBefore > 0,
    threadPaused: paused > 0,
    sentToday: sent,
    dailyCap: dailyCap(plan, store.dailyCap),
  });
  if (!g.ok) {
    await finish(msg.id, "SKIPPED", g.reason);
    return [];
  }

  const product = await loadProduct(post.productId);
  const c = await classifyText(msg.content ?? "", { channel: "comment", productName: product?.name });
  if (!c) {
    await finish(msg.id, "FLAGGED", "unclear");
    return [];
  }
  const templateId = post.templateId ?? store.defaultTemplateId;
  const template = templateId ? await db.automationTemplate.findUnique({ where: { id: templateId } }) : null;
  const decision = decideComment(c, {
    hasProduct: !!product && product.variants.length > 0,
    hasDefaultDm: !!store.defaultDm?.trim(),
    likeComments: store.likeComments,
    autoHideSpam: store.autoHideSpam,
    isFacebook: platform === "META_FACEBOOK",
    whatsappAlways: template?.whatsappAlways ?? false,
    canPrivateReply: now.getTime() - msg.createdAt.getTime() < PRIVATE_REPLY_WINDOW,
  });

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
  await finish(msg.id, specs.length ? "AUTO_REPLIED" : "FLAGGED", decision.flag, {
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
  const photosSent = product ? await db.outboxJob.count({ where: { storeId: store.id, kind: "DM_PHOTOS", recipientId: senderId } }) : 0;
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
  const ids = await createJobs(store.id, msg.id, specs);
  await finish(msg.id, specs.length ? "AUTO_REPLIED" : "FLAGGED", flag, {
    commentType: c?.type ?? null, intent: c?.intent ?? null, language: c?.language ?? null, confidence: c?.confidence ?? null, boundProductId: product?.id ?? null,
  });
  return ids;
}
```

- [ ] **Step 5: Run the test and the type-check**

Run: `npx vitest run tests/shop/pipeline.test.ts && npx tsc --noEmit -p .`
Expected: PASS (2 tests), tsc exit 0. If tsc rejects `store.plan as StorePlan` because Prisma's `StorePlan` enum is already that union, remove the cast; it is only there to decouple from the generated type.

- [ ] **Step 6: Commit**

```bash
git add src/lib/shop/outbox.ts src/lib/shop/pipeline.ts tests/shop/pipeline.test.ts
git commit -m "Run shop comments and DMs through gate, AI, policy and the outbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Webhook route and manual-reply pause

**Files:**
- Modify: `src/app/api/meta/webhooks/route.ts`
- Modify: `src/app/app/actions.ts:52-62` and `:86-96`

- [ ] **Step 1: Route: imports and function limit**

In `src/app/api/meta/webhooks/route.ts`, replace the line

```ts
import { NextResponse } from "next/server";
```

with

```ts
import { after, NextResponse } from "next/server";
```

Below `import { db } from "@/lib/db";` add:

```ts
import { processMessage } from "@/lib/shop/pipeline";
import { parseEntry, type ShopEvent } from "@/lib/shop/webhook-parse";
```

Below `export const dynamic = "force-dynamic";` add:

```ts
// Shop replies wait 8-30 s (human pace) inside after(); keep the whole run under Hobby's 60 s.
export const maxDuration = 60;
```

- [ ] **Step 2: Route: shop store resolution and ingest**

Directly above `interface IgEntry {`, add:

```ts
/** The shop store behind a connected Page or Instagram account, if the account belongs to one. */
async function storeForAccount(platform: "META_INSTAGRAM" | "META_FACEBOOK", accountId: string) {
  return db.store.findFirst({ where: platform === "META_FACEBOOK" ? { fbPageId: accountId } : { igUserId: accountId }, select: { id: true } });
}

/** Store a shop event once; Meta redelivers, and the unique key makes the second copy a no-op. */
async function ingestShop(storeId: string, ev: ShopEvent): Promise<string | null> {
  const fields =
    ev.kind === "comment"
      ? { channelType: "COMMENT" as const, externalMessageId: ev.commentId, externalThreadId: ev.postId, authorId: ev.authorId, authorHandle: ev.authorName ?? ev.authorId, parentCommentId: ev.parentCommentId }
      : { channelType: "DM" as const, externalMessageId: ev.messageId, externalThreadId: ev.senderId, authorId: ev.senderId, authorHandle: ev.senderId, parentCommentId: null };
  try {
    const row = await db.conversationMessage.create({
      data: { storeId, platform: ev.platform, direction: "INBOUND", status: "RECEIVED", content: ev.text, ...fields },
      select: { id: true },
    });
    return row.id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return null;
    throw e;
  }
}
```

- [ ] **Step 3: Route: send store accounts to the shop pipeline**

In `POST`, replace

```ts
  for (const entry of body.entry ?? []) {
    const projectId = entry.id ? await projectForAccount(platform, entry.id) : null;
    if (!projectId) continue;
```

with

```ts
  for (const entry of body.entry ?? []) {
    const store = entry.id ? await storeForAccount(platform, entry.id) : null;
    if (store) {
      for (const ev of parseEntry(body.object, entry)) {
        const id = await ingestShop(store.id, ev);
        if (id) {
          after(() =>
            processMessage(id, { delay: ev.kind === "comment" }).catch((e) =>
              console.error("[shop] processing failed:", e instanceof Error ? e.message : "unknown error"),
            ),
          );
        }
      }
      continue;
    }

    const projectId = entry.id ? await projectForAccount(platform, entry.id) : null;
    if (!projectId) continue;
```

Everything after that, the legacy Project path, stays unchanged.

- [ ] **Step 4: Manual replies pause automation**

In `src/app/app/actions.ts`, add under the existing imports:

```ts
import { pauseThread } from "@/lib/shop/pause";
```

In `replyToCommentAction`, replace

```ts
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await audit(ws.id, "app.comment_reply", `Replied to ${platform} comment ${commentId}.`, { platform, commentId });
```

with

```ts
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await pauseThread(ws.id, platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", commentId);
  await audit(ws.id, "app.comment_reply", `Replied to ${platform} comment ${commentId}.`, { platform, commentId });
```

In `sendMessageAction`, replace

```ts
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await audit(ws.id, "app.dm_send", `Sent a ${platform} message to ${recipientId}.`, { platform, recipientId });
```

with

```ts
  if (!r.ok) return { ok: false, error: r.error ?? "ناردن سەرکەوتوو نەبوو." };
  await pauseThread(ws.id, platform === "IG" ? "META_INSTAGRAM" : "META_FACEBOOK", recipientId);
  await audit(ws.id, "app.dm_send", `Sent a ${platform} message to ${recipientId}.`, { platform, recipientId });
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: tsc exit 0. All tests pass: 246 existing plus the new shop tests.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/meta/webhooks/route.ts src/app/app/actions.ts
git commit -m "Send store accounts' webhooks to the shop pipeline

Manual replies from the shop pause automation on that thread.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Retry sweep

**Files:**
- Create: `src/app/api/cron/shop-outbox/route.ts`, `vercel.json`

- [ ] **Step 1: Write the route**

`src/app/api/cron/shop-outbox/route.ts`:

```ts
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { runJob } from "@/lib/shop/outbox";
import { processMessage } from "@/lib/shop/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Retries due outbox jobs and processes shop messages that were stored but
 * never handled (e.g. the function died mid-run). Vercel Cron calls it with
 * `Authorization: Bearer $CRON_SECRET`; without the secret it refuses to run.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = Date.now();
  const due = await db.outboxJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date(now) } },
    orderBy: { nextAttemptAt: "asc" },
    take: 40,
    select: { id: true },
  });
  for (const j of due) await runJob(j.id);

  const stuck = await db.conversationMessage.findMany({
    where: { storeId: { not: null }, outcome: null, createdAt: { lt: new Date(now - 5 * 60_000), gt: new Date(now - 7 * 86_400_000) } },
    orderBy: { createdAt: "asc" },
    take: 15,
    select: { id: true },
  });
  for (const m of stuck) await processMessage(m.id);

  return NextResponse.json({ jobs: due.length, messages: stuck.length });
}
```

- [ ] **Step 2: Schedule it**

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/cron/shop-outbox", "schedule": "0 4 * * *" }]
}
```

Hobby allows one run a day. On Vercel Pro, change the schedule to `*/5 * * * *` (the spec's rollout step 4).

- [ ] **Step 3: Check the secret exists**

In the Vercel dashboard, open gituas → Settings → Environment Variables and look for `CRON_SECRET` in Production. Look only; do not reveal the value. If it is missing, **the owner** adds a random value. The agent must not type secrets. Without it the sweep returns 401, and nothing else breaks.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit -p .`
Expected: exit 0.

```bash
git add src/app/api/cron/shop-outbox/route.ts vercel.json
git commit -m "Add the shop outbox retry sweep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Operator scripts, deploy, live test

**Files:**
- Create: `scripts/shop-stores.mts`, `scripts/shop-demo.mts`

- [ ] **Step 1: Backfill script**

`scripts/shop-stores.mts`:

```ts
// Create or link a Store for every connected Page / Instagram account of merchant
// workspaces, and subscribe each to webhooks. Safe to re-run.
// Run: npx tsx --env-file=.env --env-file=.env.local scripts/shop-stores.mts
import { db } from "../src/lib/db";
import { connectStore } from "../src/lib/shop/store";

const creds = await db.oAuthCredential.findMany({
  where: { provider: { in: ["META_FACEBOOK", "META_INSTAGRAM"] }, tenant: { kind: "MERCHANT" } },
  select: { tenantId: true, provider: true, providerAccountId: true, providerAccountName: true },
});
let linked = 0;
for (const c of creds) {
  if (c.provider === "META_FACEBOOK" && c.providerAccountId.startsWith("act_")) continue;
  const id = await connectStore(c.tenantId, c.provider as "META_FACEBOOK" | "META_INSTAGRAM", c.providerAccountId, c.providerAccountName ?? "");
  if (id) linked++;
}
const stores = await db.store.findMany({ select: { id: true, name: true, fbPageId: true, igUserId: true, webhooksAt: true, automationEnabled: true } });
console.log(`credentials: ${creds.length}, linked: ${linked}`);
for (const s of stores) console.log(`${s.id}  ${s.name}  fb=${s.fbPageId ?? "-"}  ig=${s.igUserId ?? "-"}  webhooks=${s.webhooksAt ? "yes" : "NO"}  on=${s.automationEnabled}`);
await db.$disconnect();
```

- [ ] **Step 2: Demo configuration script**

`scripts/shop-demo.mts`:

```ts
// Configure one store for a live test: switch automation on, add a default
// template with Sorani samples and a demo product, and optionally tag a post.
// Run: npx tsx --env-file=.env --env-file=.env.local scripts/shop-demo.mts <storeId> [platform:postId]
import { db } from "../src/lib/db";

const [storeId, postArg] = process.argv.slice(2);
if (!storeId) throw new Error("usage: shop-demo.mts <storeId> [META_FACEBOOK:<postId>|META_INSTAGRAM:<mediaId>]");

const template =
  (await db.automationTemplate.findFirst({ where: { storeId, name: "بنەڕەت" } })) ??
  (await db.automationTemplate.create({
    data: {
      storeId,
      name: "بنەڕەت",
      publicSamples: ["نامەمان بۆت نارد، سەیری نامەکانت بکە 🌷", "وردەکارییەکانمان لە نامەدا بۆت نارد 🙏"],
      thanksSamples: ["زۆر سوپاس 🌷", "دەستت خۆش بێت 🙏"],
    },
  }));
const product =
  (await db.product.findFirst({ where: { storeId, name: "بەرهەمی تاقیکردنەوە" } })) ??
  (await db.product.create({
    data: {
      storeId,
      name: "بەرهەمی تاقیکردنەوە",
      photos: [],
      variants: { create: [{ label: "M", amountMinor: 25000, position: 0 }, { label: "L", amountMinor: 27000, position: 1 }] },
    },
  }));
await db.store.update({
  where: { id: storeId },
  data: { automationEnabled: true, defaultTemplateId: template.id, deliveryFeeMinor: 5000, deliveryTime: "١-٢ ڕۆژ" },
});
if (postArg) {
  const [platform, postId] = postArg.split(":") as ["META_FACEBOOK" | "META_INSTAGRAM", string];
  const now = new Date();
  await db.postAutomation.upsert({
    where: { storeId_platform_externalPostId: { storeId, platform, externalPostId: postId } },
    create: { storeId, platform, externalPostId: postId, postCreatedAt: now, activeUntil: new Date(now.getTime() + 30 * 86_400_000), productId: product.id },
    update: { productId: product.id, enabled: true },
  });
}
console.log(`store ${storeId}: automation on, template ${template.id}, product ${product.id}${postArg ? `, tagged ${postArg}` : ""}`);
await db.$disconnect();
```

- [ ] **Step 3: Full check, commit, push (deploys)**

Run: `npx vitest run && npx tsc --noEmit -p . && npm run build`
Expected: all tests pass, tsc exit 0, and the build succeeds.

```bash
git add scripts/shop-stores.mts scripts/shop-demo.mts
git commit -m "Add operator scripts to backfill and configure shop stores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin master
```

Wait for the Vercel deployment. Check the latest commit's status: `gh api repos/zorino96/gituas/commits/master/status --jq .state` should return `success`.

- [ ] **Step 4: Backfill and pick the test store**

Run: `npx tsx --env-file=.env --env-file=.env.local scripts/shop-stores.mts`
Expected: a list of stores. The owner's test Page and Instagram account appear with `webhooks=yes`.

If `webhooks=NO`:
- The subscribe call failed. Check that the token has the `pages_manage_metadata` scope (Facebook) or is a valid Instagram token.
- If a Meta store was created for a tenant whose `kind` is not `MERCHANT`, the owner decides which workspace should hold it. Do not change tenant kinds unasked.

- [ ] **Step 5: Check the app-level webhook fields (read only)**

In the Meta App Dashboard for app `1679071989875234`, go to Webhooks and read the settings:
- **Page:** `feed` and `messages` are subscribed.
- **Instagram:** `comments` and `messages` are subscribed.

Changing these is a persistent-configuration change. If a field is missing, **ask the owner first**, then subscribe it.

- [ ] **Step 6: Configure the test store and tag a post**

Run: `npx tsx --env-file=.env --env-file=.env.local scripts/shop-demo.mts <storeId> META_FACEBOOK:<postId>`, using a recent post on the owner's test Page. Get the post id from the shop's comments page URL, or from `GET /{page-id}/feed?limit=1` with the Page token in the same script style.

- [ ] **Step 7: Live test — the owner comments from a personal account**

The agent must not comment as the owner. Ask the owner to post these on the tagged post, one by one:
1. `چەندە؟` → within ~30 s: a varied Sorani public reply; a Messenger card for "بەرهەمی تاقیکردنەوە" with the M/L prices and delivery; the comment liked.
2. `زۆر جوانە 😍` → a short thank-you, no message.
3. `هەرزانتری نییە؟` → nothing sent. In the database: `outcome = FLAGGED`, `outcomeReason = negotiation`.
4. Reply in Messenger to the card with `قیاسی L هەیە؟` → an answer listing the in-stock sizes.

Check each in the native Facebook app. Then check the rows: every `ConversationMessage` has an `outcome`, and every `OutboxJob` is `SENT` or has a `lastError` that explains why. Run the same four on the Instagram test account. There the card arrives as text and has no like.

- [ ] **Step 8: Report**

Tell the owner in Sorani:
- which of the eight checks passed;
- any `lastError` values;
- that automation is on only for the test store.

Merchant screens are plan A2.

---

## Self-review (done while writing)

- **Spec coverage:**

  | Spec requirement | Task |
  |---|---|
  | Behaviour/gate | 4 |
  | Classify | 7 |
  | Act table | 5 |
  | Varied sample + guard | 7 |
  | Product card + composition | 6 |
  | Private-reply rules | 5, 11 |
  | Follow-up DMs | 5, 6, 11 |
  | Timing | 11, 12 |
  | Webhook subscription | 8, 10 |
  | Data model | 1 |
  | Components | 2–13 |
  | Plans/limits | 2, 11 |
  | Errors | 8, 11 |
  | Thread takeover | 10, 12 |
  | Rollout steps 1–3 | 14 |

  Merchant screens are out of this plan by design (A2): the Automation page, Templates, Products, the per-post row, the Composer picker, the inbox "needs you" filter, and the Setup checklist.
- **Types:** these names are used identically across tasks:
  - `MetaPlatform` (webhook-parse, re-exported by meta-client)
  - `Lang`/`LANGS` (money)
  - `Classification`/`CommentType`/`Intent` (policy)
  - `CardProduct`/`CardStore`/`FbElement` (compose)
  - `JobSpec`/`JobPayload`/`OutboxKind` (jobs)
  - `StoreAccount`/`SendResult`/`MetaMessage` (meta-client)
  - `StorePlan` (plans)
- **Known limits accepted for v1:**
  - Classification is not measured against a real-comment eval set yet.
  - The daily cap counts sends since UTC midnight, not Iraq midnight.
  - Instagram self-detection relies on the entry id or the stored username.
