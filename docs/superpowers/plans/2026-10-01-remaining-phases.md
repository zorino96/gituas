# Remaining Phases — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish what the owner asked for on 2026-10-01:
- the DeepSeek model fix;
- a 5-minute clock;
- the newsroom trial that freezes when unpaid;
- post scheduling;
- YouTube in the shop and newsroom;
- orders by city;
- an Arabic shop UI.

**Owner decisions:**
- **Trial:** new newsroom workspaces get 14 days. After that, unless paid, they are **frozen**: they can read the news, but cannot AI-draft, improve or publish.
- **Scheduling excludes TikTok.** Its audited Direct Post flow must stay untouched.
- **Prices** stay as in `2026-09-30-billing-wayl.md`.

**Conventions:**
- One branch, `remaining-phases`. Commit per task, ending with your Co-Authored-By trailer.
- **Never push, run `prisma db push`, or write to the database.** The owner applies the single schema change.
- Git Bash, from the repo root.
- UI uses existing `gm-` classes and Sorani text exactly as given. Follow the patterns in `src/app/app/automation/*`, `src/app/app/billing/*` and `src/app/app/settings/*`.
- Finish every task with `npx vitest run && npx tsc --noEmit -p .`. Also run `npm run build` for UI tasks, and restore `package-lock.json` if the build changes it.

---

## Phase 0 — Foundations

### Task 0.1: Schema for all phases
In `prisma/schema.prisma`:
- `model Tenant`: add `trialEndsAt DateTime?` and `scheduledPosts ScheduledPost[]`, `orders Order[]`.
- Append:

```prisma
enum ScheduleStatus {
  PENDING
  RUNNING
  DONE
  FAILED
  CANCELLED
}

/// A composer post to publish later (Facebook, Instagram, YouTube — never TikTok).
model ScheduledPost {
  id          String         @id @default(cuid())
  tenantId    String
  createdById String
  /// The composer's PublishInput, as JSON.
  input       Json
  runAt       DateTime
  status      ScheduleStatus @default(PENDING)
  /// The PublishOutcome[] after running.
  result      Json?
  lastError   String?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt
  tenant      Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([status, runAt])
  @@index([tenantId, runAt])
}

enum OrderStatus {
  NEW
  CONFIRMED
  SENT
  DELIVERED
  RETURNED
  CANCELLED
}

/// A shop order, entered by the merchant or opened automatically from an ORDER comment/DM.
model Order {
  id               String      @id @default(cuid())
  tenantId         String
  storeId          String?
  customerName     String      @default("")
  phone            String?
  /// Governorate code from src/lib/orders/cities.ts, or null until known.
  city             String?
  address          String?
  productId        String?
  productName      String      @default("")
  variantLabel     String      @default("")
  amountMinor      Int         @default(0)
  currency         String      @default("IQD")
  deliveryFeeMinor Int?
  cod              Boolean     @default(true)
  status           OrderStatus @default(NEW)
  /// "MANUAL" | "COMMENT" | "DM"
  source           String      @default("MANUAL")
  sourceMessageId  String?     @unique
  note             String?
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt
  tenant           Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, createdAt])
  @@index([tenantId, city])
  @@index([tenantId, status])
}
```

Then run `npx prisma generate`, tsc and the tests. Commit with the message "Add schema for trials, scheduled posts and orders".

### Task 0.2: DeepSeek without the retired model
- `deepseek-chat` was announced as discontinued on 2026-07-24.
- `src/lib/ai/deepseek.ts` maps `thinking === false` to `DEEPSEEK_MODELS.noThinking = "deepseek-chat"`. Change it:
  - non-thinking calls use `DEEPSEEK_MODELS.fast` (`"deepseek-flash"`), and add `thinking: { type: "disabled" }` to the request body;
  - remove `noThinking` from `DEEPSEEK_MODELS`;
  - update the comment at the top.
- Search for other uses of `noThinking` or `deepseek-chat` (`grep -rn`) and update them. Measurement scripts under `scripts/` are fine to leave, but mention them.
- If a test asserts the model name, update it.
- Commit with the message "Call deepseek-flash with thinking disabled instead of the retired deepseek-chat".

### Task 0.3: A 5-minute clock via GitHub Actions
Vercel Hobby crons run once a day. Create `.github/workflows/cron.yml`:

```yaml
name: cron
on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch: {}
jobs:
  tick:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: Run due scheduled posts and the shop outbox
        env:
          CRON_SECRET: ${{ secrets.CRON_SECRET }}
        run: |
          if [ -z "$CRON_SECRET" ]; then echo "CRON_SECRET not set; skipping"; exit 0; fi
          for p in /api/cron/scheduled /api/cron/shop-outbox; do
            curl -fsS -m 55 -H "Authorization: Bearer $CRON_SECRET" "https://gituas.com$p" || echo "tick $p failed"
          done
```

(`/api/cron/scheduled` is created in Phase 2.) Commit with the message "Tick scheduled posts and the shop outbox every five minutes".

---

## Phase 1 — Newsroom trial and freeze

### Task 1.1: Trial rules (pure) and enforcement
1. Create `src/lib/billing/trial.ts` with:
   - `TRIAL_DAYS = 14`.
   - `newsroomAccess(t: { kind: string; plan: string; planPaidUntil: Date | null; trialEndsAt: Date | null }, now: Date): { active: boolean; reason: "paid" | "trial" | "legacy" | "frozen"; daysLeft: number | null }`, with these rules:
     - non-NEWS → active, reason "paid";
     - `planPaidUntil > now` → active, "paid";
     - `trialEndsAt == null` → active, "legacy";
     - `trialEndsAt > now` → active, "trial", `daysLeft` = ceil of the remaining days;
     - otherwise → not active, "frozen".
   - Unit tests in `tests/billing/trial.test.ts` for each branch.
2. `src/lib/billing/limits.ts` `assertWithin`:
   - Also select `kind`, `planPaidUntil` and `trialEndsAt`.
   - When `newsroomAccess(...).active` is false, throw `new LimitReached(metric, 0)` with a marker: add an optional third constructor arg `frozen = false` and expose `readonly frozen`.
   - `limitMessage(e)` returns `ماوەی تاقیکردنەوە تەواو بووە — بۆ بەردەوامبوون لە «پلان و پارەدان» پلانێک هەڵبژێرە.` when `e.frozen`.
   - Existing callers need no change.
3. **New newsroom workspaces start a trial.** Find where a workspace becomes NEWS: `claimKind` and `setupNewsDesk` in `src/app/app/data.ts`, and any `kind: "NEWS"` create in `src/`. Set `trialEndsAt: now + 14 days` there, only if it is null.
4. **Remove the "lapsed paid → LITE" downgrade** from `expireOverdue` in `src/lib/billing/invoices.ts`. Freezing is now computed, not stored. Keep the shop store downgrade and the invoice expiry.
5. **Banner.** In the newsroom desk shell, find the component that wraps `/newsroom/(desk)/*` pages (`src/app/newsroom/(desk)/layout.tsx` or `desk-shell.tsx`). Using `newsroomAccess`:
   - reason "trial" → `<p className="gm-note">{daysLeft} ڕۆژ لە تاقیکردنەوەی بەخۆڕایی ماوە — <a href="/newsroom/billing" className="gm-link">پلان هەڵبژێرە</a></p>`;
   - "frozen" → `<p className="gm-note warn">ماوەی تاقیکردنەوە تەواو بووە. هەواڵەکان دەبینیت، بەڵام نووسین و بڵاوکردنەوە ڕاگیراوە. <a href="/newsroom/billing" className="gm-link">پلان هەڵبژێرە</a></p>`.
6. **Billing page:** the `legacyFree` hiding of LITE (`billing-client.tsx`) is no longer needed. Show all four newsroom plans. For a newsroom in trial, show `تاقیکردنەوە: {daysLeft} ڕۆژ ماوە`.
7. **Operator script** `scripts/newsroom-trials.mts` gives existing NEWS workspaces with `trialEndsAt` null and no running paid plan a trial of now + 14 days, and prints the count. The owner or controller runs it after the schema push.

Commit with the message "Give new newsrooms a 14-day trial, then freeze writing until paid".

---

## Phase 2 — Scheduled posts (Facebook, Instagram, YouTube; never TikTok)

### Task 2.1: Split publishing from the session
- In `src/app/app/actions.ts`, `publishAction` gets the workspace from the session and then publishes.
- Move the publishing body into an exported function in a new, non-"use server" module, `src/lib/merchant/publish-core.ts`: `publishForWorkspace(ws: { id: string; kind: "MERCHANT" | "NEWS"; role: Role }, input: PublishInput): Promise<PublishOutcome[] | { error: string }>`. Everything after the auth and permission checks moves there, including:
  - validation;
  - the `assertWithin` for news drafts;
  - per-target publishing;
  - `tagPublishedPost`;
  - `recordNewsPublish`.
- `publishAction` keeps its signature. It authenticates and calls `publishForWorkspace`.
- Move the `PublishInput` / `PublishOutcome` types into the core module and re-export them from `actions.ts` if the client imports them from there.
- Behaviour must not change. Run the full test suite and the build.
- Commit with the message "Separate publishing from the signed-in session".

### Task 2.2: Schedule, run, cancel
1. Create `src/lib/merchant/schedule.ts` (pure, tested in `tests/merchant/schedule.test.ts`) with:
   - `scheduleProblem(targets: string[], runAt: Date, now: Date): string | null`, returning:
     - `بۆ تیکتۆک خشتەکردن نییە — ڕاستەوخۆ بڵاوی بکەرەوە.` when targets include `"TT"`;
     - `کاتەکە دەبێت لانیکەم ١٠ خولەک دوای ئێستا بێت.` when `runAt < now + 10 min`;
     - `کاتەکە دەبێت لە ماوەی ٦٠ ڕۆژدا بێت.` when it is more than 60 days away;
     - `null` otherwise.
   - `baghdadLocalToUtc(local: "YYYY-MM-DDTHH:mm"): Date`, treating the input as Asia/Baghdad (UTC+3, no DST).
2. Server actions in `src/app/app/publish/schedule-actions.ts`:
   - `schedulePublishAction(input, runAtLocal)`:
     - check the workspace and `can(role, "publish")`;
     - run `scheduleProblem`;
     - check the media path prefix exactly as `publishAction` does;
     - create a `ScheduledPost` with `createdById` = session user id;
     - return `{ ok: true, id }`.
   - `cancelScheduledAction(id)`: PENDING → CANCELLED, only for the workspace's own posts.
   - `listScheduled()` returns this workspace's PENDING/RUNNING/FAILED posts, newest `runAt` first, at most 20, with `runAt`, the caption's first 60 characters, the targets, the status and `lastError`.
3. Cron route `src/app/api/cron/scheduled/route.ts`:
   - Guard with `CRON_SECRET` like `shop-outbox`, and set `maxDuration = 60`.
   - Claim up to 5 due posts: find PENDING with `runAt <= now`, then for each `updateMany({ where: { id, status: "PENDING" }, data: { status: "RUNNING" } })`, and only proceed when the count is 1.
   - Load the tenant (`kind`) and publish with `publishForWorkspace({ id: tenantId, kind, role: "OWNER" }, input)`. The post was authorised when it was scheduled.
   - Store `result`. Status becomes DONE when at least one outcome is ok, otherwise FAILED, with `lastError`.
4. Composer UI (`src/app/app/publish/publish-client.tsx`):
   - Above the publish button, add a switch-row `کات` with two chips: `ئێستا` / `کاتێکی دیاریکراو`.
   - Scheduled mode shows `<input type="datetime-local" className="gm-input">` labelled `کاتی بڵاوکردنەوە (کاتی عێراق)`.
   - In scheduled mode, TikTok targets are disabled, with the hint `تیکتۆک تەنها ڕاستەوخۆ`.
   - The button text becomes `خشتەکردن`. On success show `gm-ok` `خشتە کرا — {date} بڵاو دەکرێتەوە.`
   - Under the composer, add a card `پۆستە خشتەکراوەکان`, listing `listScheduled()` rows with a `هەڵوەشاندنەوە` button (cancel). FAILED rows show the `lastError` in `gm-err`.
5. Commit with the message "Schedule posts for later".

---

## Phase 3 — YouTube in the shop and newsroom

**Read first:**
- `src/lib/oauth/registry.ts`: the YouTube provider id, scopes and connect route.
- `src/lib/publishers/youtube.ts`: `publishToYouTube` signature and its input: title, description, video URL, privacy.
- `src/lib/publishers/youtube-engage.ts`: `fetchChannelStats`, `fetchRecentVideos`.
- `src/app/app/data.ts`: `Connections`, `loadConnections`.
- `src/app/app/settings/*`: how connect buttons are rendered for FB, IG and TT.
- `src/lib/merchant/caption.ts`: `CAPTION_LIMITS`, `Target`.

### Task 3.1: Connect YouTube
- Add the YouTube provider to `loadConnections` and the `Connections` type (`connected`, `name` = channel title, `accountId`).
- In the shop settings connections list, add a row `یوتیوب`. Its connect button goes to the provider's existing OAuth start route with `returnTo` set to the settings page, following the FB, IG and TT buttons' pattern.
- Remove the separate YouTube credential query that `src/app/app/billing/load.ts` added (`loadAccounts`), and use the connection instead.
- Commit with the message "Connect YouTube from the shop settings".

### Task 3.2: Publish to YouTube
- Add `"YT"` to the composer targets (`CAPTION_LIMITS.YT = 5000`, the description limit), shown only when YouTube is connected. It is **video only**.
- Title = the caption's first line, cut to 100 characters (Array.from), falling back to `ڤیدیۆ`. Description = the full caption.
- `publishForWorkspace` calls `publishToYouTube` for `"YT"` and maps the result to a `PublishOutcome` (`url` = the watch URL).
- `captionProblems` / `targets` validation: YouTube requires a video, so an image with a YT target gives the error `یوتیوب تەنها ڤیدیۆ وەردەگرێت.`
- Scheduling allows YT.
- Show `gm-hint` under the YT target: `تا Google ئەپەکە پەسەند دەکات، ڤیدیۆکان وەک تایبەت (Private) بڵاو دەبنەوە.` Uploads from unverified Google API projects are locked private.
- Commit with the message "Publish videos to YouTube from the composer".

### Task 3.3: YouTube in insights
- In `src/app/app/insights/*` (and whatever the newsroom insights re-export), when YouTube is connected, add a YouTube block from `fetchChannelStats` (subscribers, views, video count) and `fetchRecentVideos` (top 3 with views).
- Labels: `یوتیوب`, `بەشداربوو`, `بینین`, `ڤیدیۆ`.
- Degrade gracefully on error, like the existing blocks.
- Commit with the message "Show YouTube in insights".

---

## Phase 4 — Orders by city

### Task 4.1: Cities and order helpers (pure)
1. Create `src/lib/orders/cities.ts`: `CITIES` is an ordered list of `{ code, ckb, ar }` for Iraq's governorates. The Kurdistan Region comes first: `erbil` هەولێر/أربيل, `sulaymaniyah` سلێمانی/السليمانية, `duhok` دهۆک/دهوك, `halabja` هەڵەبجە/حلبجة, `kirkuk` کەرکووک/كركوك. Then `baghdad` بەغدا/بغداد, `basra` بەسرە/البصرة, `nineveh` نەینەوا (مووسڵ)/نينوى, `anbar`, `babil`, `karbala`, `najaf`, `diyala`, `wasit`, `maysan`, `dhiqar`, `muthanna`, `qadisiyah`, `salahaddin`, each with proper ckb and ar names. Export `cityLabel(code, lang)`.
2. Create `src/lib/orders/stats.ts`: `ordersByCity(orders: { city: string | null; amountMinor: number; status: string }[])` returns rows `{ city, count, totalMinor }`. Exclude CANCELLED and RETURNED, sort by count descending, and label a null city `نەزانراو`.
3. Tests in `tests/orders/*.test.ts`.
4. Commit with the message "Add Iraqi cities and order stats".

### Task 4.2: Orders page
- Create `src/app/app/orders/{page.tsx,orders-client.tsx,actions.ts}`.
- Actions check the workspace and `can(role, "engage")`:
  - `saveOrderAction(id|null, input)`:
    - accepts `customerName`, `phone` (via `normalizePhone` from `src/lib/merchant/phone.ts` when present), `city` (must be a `CITIES` code or empty), `address`, `productId` (must belong to one of the workspace's stores), `variantLabel`, `price`, `currency`, `deliveryFee` (use `parsePrice` from `src/lib/shop/forms.ts`), `cod`, `status`, `note`;
    - fills `productName` from the product.
  - `setOrderStatusAction(id, status)`.
- Page:
  - Title `داواکارییەکان`.
  - Status filter chips: `هەموو`, `نوێ`, `پشتڕاستکراوە`, `نێردراوە`, `گەیەندراوە`, `گەڕاوەتەوە`, `هەڵوەشاوە`.
  - A `داواکاری نوێ` button opens an inline editor. The fields are:
    - `ناوی کڕیار`, `ژمارەی مۆبایل`, `شار` (select from CITIES), `ناونیشان`;
    - `بەرهەم` (select of the workspace's products, or `تر`), `جۆر`, `نرخ`, `کرێی گەیاندن`;
    - `پارەدان لە کاتی گەیاندن` checkbox, `تێبینی`;
    - `پاشەکەوت`.
  - List rows (`gm-target`) show the customer, the city label, the product + variant, the amount (`formatMoney`) and a status `<select>` (`setOrderStatusAction`). Source COMMENT/DM gets `gm-badge ghost` `لە کۆمێنت` / `لە نامە`.
  - A `بە پێی شار` card lists `ordersByCity` rows.
- Nav: add a merchant tab `{ href: `${base}/orders`, label: "داواکاری", Icon: Package }`. The tab grid already adapts.
- Commit with the message "Add the orders page".

### Task 4.3: Orders from automation
- In `src/lib/shop/pipeline.ts`, when a comment or DM classification has `type === "ORDER"` and automation handled it (including when the only action was a flag), upsert an `Order` keyed by `sourceMessageId = msg.id`, with:
  - `tenantId`: the store's tenant; `storeId`;
  - `customerName` = `authorHandle ?? ""`;
  - `productId` / `productName` from the bound product;
  - `amountMinor` = the first in-stock variant's price;
  - `source` "COMMENT" or "DM"; `status` NEW.
- Use `db.order.upsert` with an empty `update`. Wrap it in try/catch so a failure never breaks replying.
- Commit with the message "Open an order from ORDER comments and DMs".

---

## Phase 5 — Arabic UI for the shop

### Task 5.1: i18n core
1. Create `src/lib/i18n/index.ts`:
   - `type Lang = "ckb" | "ar"`;
   - `LANG_COOKIE = "gm_lang"`;
   - `getLang(): Promise<Lang>` (server, from `cookies()`, default `ckb`);
   - `dict(lang)` returning the dictionary.
2. Create `src/lib/i18n/ckb.ts` and `ar.ts`, exporting objects with the **same keys**. A unit test must assert identical key sets.
3. Create `src/lib/i18n/client.tsx`, with a `LangProvider` + `useT()` hook for client components.
4. Add `setLangAction(lang)` (in `src/app/app/actions.ts` or a new file). It sets the cookie (1 year, `sameSite: "lax"`) and revalidates the layout.
5. In `src/app/app/layout.tsx`, wrap in `LangProvider` with the dictionary, and set `lang={lang}` on the root element (`dir` stays `rtl`).
6. In settings, add a card `زمان / اللغة` with two chips, `کوردی` / `العربية`.
7. Commit with the message "Add Kurdish/Arabic language switching for the shop".

### Task 5.2: Translate the shop screens
- Move every user-visible Sorani string in the shop merchant screens into the dictionaries. Write natural Iraqi-friendly Modern Standard Arabic translations. The screens are:
  - `src/app/app/{layout,nav,page}.tsx` and home;
  - `comments`, `messages`, `publish`, `insights`, `settings`, `automation`, `products`, `billing`, `orders`.
- Server components use `dict(await getLang())`; client components use `useT()`.
- Server action error strings that reach the UI may stay Sorani in this task. List them in the commit body for a follow-up.
- The newsroom (`/newsroom/*`) is out of scope, except where it re-exports shop pages, which then follow the same cookie.
- Build must pass.
- Commit with the message "Translate the shop screens into Arabic".

---

## Hand-off (controller)
1. Review, then show the migration SQL. It must be additive.
2. The owner runs one line in PowerShell:
   `npx prisma db push; if ($?) { git checkout master; git merge --ff-only remaining-phases; git push origin master }`
3. The controller runs `scripts/newsroom-trials.mts`.
4. The owner adds the `CRON_SECRET` secret in **GitHub** (repo Settings → Secrets → Actions) with the **same value** as in Vercel.
