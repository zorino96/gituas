# Newsroom Autopilot, Plan-Speed Refresh and Per-Desk Wording — Design + Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:**
- A newsroom's stories arrive by themselves, at a speed set by its plan.
- Two outlets never get the same wording for the same story.
- On the two top plans a desk can run on autopilot: matching stories are drafted, turned into a branded card and posted to Facebook and Instagram with no human.
- The billing page lists what each plan includes.

## Owner decisions (2026-10-02)

- **Refresh interval per plan:**

  | Plan | Interval |
  |---|---|
  | ENTERPRISE | 30 s |
  | AUTO | 60 s |
  | MANUAL | 120 s |
  | LITE | 300 s |

- **Autopilot:**
  - Full auto-publish only on **AUTO and ENTERPRISE**.
  - Every plan may use **auto-draft**: the AI prepares drafts and a person publishes.
- **Wording:** the same article reaching two outlets must not read the same.
- **Billing:** the page must show the features each plan includes.

## Constraints that shape the design

- **TikTok is never automatic.** TikTok's Direct Post rules require the user to review and consent to every post. Autopilot targets are Facebook and Instagram only. A TikTok post stays one tap away, through the existing composer.
- **YouTube is video-only.** News cards are images, so YouTube is not an autopilot target until a video phase exists.
- **Cards are rendered in the user's browser today** (`html-to-image` in `src/app/newsroom/(desk)/news/[id]/editor.tsx`). Autopilot needs a **server-side renderer**. Satori / `next/og` cannot shape Arabic-script text, so the renderer is headless Chromium screenshotting the same React card template.
- **Clock:**
  - GitHub Actions ticks every 5 minutes at best, and Vercel Hobby crons are daily. So today every desk is served at ~5-minute granularity in the background.
  - A desk with its news page open refreshes at its plan's speed through the page itself.
  - On Vercel Pro, a per-minute cron line reaches 60 s, and the tick handler's in-function second pass reaches 30 s.
  - **Do not add a sub-daily cron to `vercel.json`**: Hobby rejects the deployment.
- The agent cannot run `prisma db push`. The owner applies the schema, once. The agent may `git push origin master`.

## Conventions

- Branch `newsroom-autopilot`. Commit per task, ending with your Co-Authored-By trailer.
- Never push, run `prisma db push`, or write to the database.
- Git Bash, from the repo root.
- Finish every task with `npx vitest run && npx tsc --noEmit -p .`. UI tasks also run `npm run build`, then restore `package-lock.json`, unless the task itself changes dependencies.
- UI uses the `gm-`/`nr-` classes and the i18n dictionaries (`src/lib/i18n/ckb.ts` + `ar.ts`, identical keys). The newsroom's own screens are Sorani today: add new newsroom strings in Sorani directly where the surrounding screen is not yet translated, and through the dictionaries where it is (billing).

---

## Task 1: Schema and plan capabilities

**Schema (`prisma/schema.prisma`), additive:**
- `NewsSettings`:
  - `autoMode String @default("OFF")` (`OFF` | `DRAFT` | `PUBLISH`);
  - `autoTargets String[] @default([])` (`FB`, `IG`);
  - `autoDailyMax Int @default(20)`;
  - `autoMinGapMin Int @default(3)`;
  - `voiceNote String?`;
  - `lastAutoAt DateTime?`.
- `NewsItem`: `autoTriedAt DateTime?` and `@@index([tenantId, status, autoTriedAt])`.
- `NewsDraft`: `auto Boolean @default(false)`.
- `SourceCache`: `etag String?`, `lastModified String?`.

Run `npx prisma generate`.

**`src/lib/billing/plans.ts`:** extend the `NEWS_LIMITS` entries with `refreshSec` and `autoPublish`:

| Plan | refreshSec | autoPublish |
|---|---|---|
| LITE | 300 | false |
| MANUAL | 120 | false |
| AUTO | 60 | true |
| ENTERPRISE | 30 | true |

Export `refreshSecFor(plan)` and `canAutoPublish(plan)`. Unit-test both.

Commit: "Add autopilot settings and per-plan refresh speeds".

## Task 2: Plan features on the billing page

- Create `src/lib/billing/features.ts` (pure, tested): `planFeatures(product, plan)` returns an ordered list of `{ key, value }` built from `NEWS_LIMITS` / `SHOP_LIMITS` (`src/lib/shop/plans.ts`).
  - **NEWS:** refresh speed (30 s / 1 min / 2 min / 5 min), drafts per month, improves per month, publishes per month, sources, seats, desks, and mode (auto-draft only, or auto-publish to Facebook + Instagram).
  - **SHOP MERCHANT / PRO:** automated posts (25 / all), automatic replies per day, AI rewrites per month.
- Add i18n keys for the labels to `billing` in both `ckb.ts` and `ar.ts`. Sorani labels:
  - `نوێکردنەوەی هەواڵ` with values `هەر ٣٠ چرکە`, `هەر خولەکێک`, `هەر ٢ خولەک`, `هەر ٥ خولەک`;
  - `ڕەشنووسی AI لە مانگێکدا`, `باشترکردن لە مانگێکدا`, `بڵاوکردنەوە لە مانگێکدا`;
  - `سەرچاوە`, `ئەندامی تیم`, `مێز`;
  - `ئۆتۆپایلۆت` with values `ڕەشنووسی خۆکار — بڵاوکردنەوە بە دەست` and `بڵاوکردنەوەی تەواو خۆکار (فەیسبووک و ئینستاگرام)`;
  - shop: `پۆستی ئۆتۆمەیشنکراو`, `وەڵامی خۆکار لە ڕۆژێکدا`, `گۆڕینی AI لە مانگێکدا`, `هەموو پۆستەکان`.
- `src/app/app/billing/billing-client.tsx`: render plans as a `gm-grid` of plan cards (name, price per month, the feature list with a check icon per row, then the buy/renew button), replacing the bare buttons. The current plan's card gets a `gm-badge`. Both products.

Commit: "List what each plan includes on the billing page".

## Task 3: Plan-speed refresh

1. **`src/lib/news/ingest.ts`:**
   - The per-tenant throttle becomes the tenant plan's `refreshSecFor(plan) * 1000` (load `tenant.plan`; default MANUAL), replacing the fixed `THROTTLE_MS`.
   - `cached(key, …)` takes the TTL to use.
     - For `rss:` keys it is `max(30 s, the requesting tenant's refresh interval)`, so a slower plan never forces a refetch but a faster plan gets fresh data.
     - GDELT stays at 10 min and NewsData at 15 min.
2. **Conditional GET** (`src/lib/news/sources/rss.ts` + `cached`):
   - Send `If-None-Match` / `If-Modified-Since` from `SourceCache.etag` / `lastModified`.
   - On `304`, keep the cached items and bump `fetchedAt`.
   - On `200`, store the new validators.
   - Keep the SSRF checks, redirect limit and timeout exactly as they are.
   - Unit-test the header building and the 304 path with a stubbed `fetch`.
3. **Client auto-refresh.** Create `src/app/newsroom/(desk)/news/auto-refresh.tsx` (client):
   - While the tab is visible, call `router.refresh()` every `refreshSec` seconds. Pause on `visibilitychange` hidden; do not stack calls.
   - Render a small `gm-hint` line: `نوێکردنەوەی خۆکار: هەر {label}`.
   - Mount it on the news page with the plan's `refreshSec`.
4. **Background tick.** Create `src/app/api/cron/news/route.ts` (GET, `CRON_SECRET` Bearer like the other cron routes, `maxDuration = 60`):
   - It runs `tickNewsrooms()` from `src/lib/news/tick.ts`.
   - `tickNewsrooms` picks NEWS tenants whose `NewsSettings.autoMode !== "OFF"`, which are not frozen (`newsroomAccess`), and which are due by their plan interval (`lastFetchedAt`).
   - For each it runs `ingest(tenantId)`, then `classifyPending(tenantId)`, then `runAutopilot(tenantId)` (Task 6; until then a no-op export).
   - After the first pass, if a tenant with a 30-second plan was served and fewer than 25 s have elapsed, it waits until the 30 s mark and runs one more pass for 30-second tenants only. It never runs past 50 s.
   - It returns counts as JSON.
   - Add `/api/cron/news` to the loop in `.github/workflows/cron.yml`.
   - Do not touch `vercel.json`. Add a comment in the route: "On Vercel Pro add `{ "path": "/api/cron/news", "schedule": "* * * * *" }` to vercel.json for 60 s / 30 s service."

Commit: "Refresh news at the plan's speed, in the page and in the background".

## Task 4: A different wording for every desk

1. Create `src/lib/news/voice.ts` (pure, tested):
   - `voiceFor(tenantId: string): string` picks, deterministically from a hash of the tenant id, one option from each of three lists, and returns a short English "House style for this outlet" paragraph.
     - **Lead:** start with who acted / start with what happened / start with where and when / start with the consequence.
     - **Headline:** verb-led / noun-led with the key fact / two-part with a colon.
     - **Rhythm:** one longer sentence then a short one / two even sentences / three short sentences.
   - `sameStoryTooClose(a: {headline, body}, b: {headline, body}): boolean` reuses the n-gram / LCS helpers in `src/lib/news/rules.ts`, with the same thresholds as the source copy check. Export what is needed from `rules.ts`.
   - Tests:
     - same id → same voice;
     - at least 3 distinct voices across 12 ids;
     - identical drafts are "too close";
     - clearly different drafts are not.
2. **`src/lib/news/draft.ts`:** `draftFor(item, strength, feedback?, opts?: { voice?: string; voiceNote?: string | null; avoid?: { headline: string; body: string } })`.
   - Append the house style, and the outlet's own `voiceNote` if it is set, to the system prompt. Cut the note to 300 characters, and label it as a style preference that must never override the facts-only rules.
   - When `avoid` is given, add a feedback block, following the existing feedback-block pattern: "Another outlet already published this story with very similar wording. Write it again with clearly different words and sentence structure. Same facts, add none."
3. **`draftNewsAction`** (`src/app/newsroom/(desk)/news/actions.ts`):
   - Pass `voiceFor(ws.id)` and `NewsSettings.voiceNote`.
   - After a successful draft, look up other tenants' `NewsDraft` rows whose `NewsItem.url` equals this item's url, from the last 7 days, at most 5.
   - If `sameStoryTooClose` with any of them, redraft **once** with `avoid` set to ours, at the same strength, within the existing deadline. Keep the better result even if it is still close.
   - This must not add a usage count.
4. **Settings:** in the newsroom settings UI (`src/app/app/settings/news-settings.tsx`, or wherever newsroom-only settings live), add a field `شێوازی نووسینی کەناڵەکەت (ئارەزوومەندانە)`:
   - with the hint `بۆ نموونە: ڕستەی کورت، بێ وشەی بیانی، ناونیشانی بەهێز. AI هەر تەنها ڕاستییەکانی سەرچاوەکە دەنووسێت.`;
   - saved by a new action that needs `can(role, "configure")` and limits the text to 300 characters.

Commit: "Give every desk its own wording for the same story".

## Task 5: Render the card on the server

1. Add the dependencies `puppeteer-core` and `@sparticuz/chromium`. Commit the `package.json` / `package-lock.json` changes in this task. In `next.config.*`, add both to `serverExternalPackages`.
2. **Render page.** Create `src/app/newsroom/card-render/[id]/page.tsx`:
   - It is a server page outside the `(desk)` group, with no shell.
   - It renders exactly the card the editor renders (the same template component from `src/lib/cards/*`, the same fonts and CSS) for draft `id`, with its tenant's `BrandKit`, at 1080×1350, in an element `#card`.
   - It requires `?t=<token>`: `token = HMAC-SHA256(AUTH_SECRET, "<draftId>.<expiryUnix>")`, sent as `<expiry>.<hex>`, and valid for at most 5 minutes. Any other request gets `notFound()`.
   - No session is required.
   - Put the token helpers in `src/lib/cards/render-token.ts`, with unit tests for sign / verify / expiry / tamper.
3. **`src/lib/cards/server-render.ts`**: `renderCardServer(draftId: string, origin: string): Promise<Buffer>`.
   - Launch Chromium:
     - on Vercel, `@sparticuz/chromium`'s `executablePath()` and args;
     - locally, `process.env.CHROME_PATH`, or the default Windows/macOS/Linux Chrome path.
   - Use a 1080×1350 viewport with `deviceScaleFactor` 1.
   - `goto` the render page with a fresh token, wait for `document.fonts.ready` and for images, then screenshot `#card` as JPEG, quality 92.
   - Always close the browser. Apply a 25 s overall timeout.
4. **`renderAndStoreCard(draftId, tenantId, origin)`**: render, then upload with `put()` from `@vercel/blob` to `merchant/<tenantId>/news-card-<Date.now()>.jpg` (public). Set `NewsDraft.cardUrl` / `cardPath`. Return `{ url, pathname }`.
5. **Local check** (no DB writes beyond what the function does to one existing test draft; **ask the controller before running anything that writes**): at minimum, render to a Buffer for an existing draft id through a small script, and save the JPEG to the scratch folder for a visual look. Report its size and dimensions.

Commit: "Render news cards on the server".

## Task 6: The autopilot

1. Create `src/lib/news/autopilot.ts`:
   - `autopilotCandidates(...)` is pure and tested. Given items (`id`, `clusterKey`, `category`, `subcategory`, `status`, `publishedAt`, `autoTriedAt`), the chosen categories, `now`, and the clusters that already have a draft, it returns the items to handle. An item qualifies when it is:
     - status NEW;
     - classified (`category` not null);
     - matching the desk's chosen categories, by the same rule as `categoryWhere` but **without** the "unclassified passes" branch;
     - published within the last 6 hours;
     - never tried (`autoTriedAt` null);
     - the first of its `clusterKey`, and that cluster has no DRAFTED or PUBLISHED item.

     The result is ordered oldest first.
   - `autoBudget(...)` is pure and tested. Given the mode, plan, drafts used / limit, publishes used / limit, auto posts today, `autoDailyMax`, `lastAutoAt`, `autoMinGapMin` and `now`, it returns how many to draft and how many to publish this tick. At most 3 per tick. It returns 0 when over quota, at the daily max, or inside the minimum gap. `PUBLISH` is downgraded to `DRAFT` when the plan cannot auto-publish.
   - `runAutopilot(tenantId)`:
     - Load settings, plan, usage and connections. Stop if the mode is OFF or the newsroom is frozen.
     - Pick candidates and the budget.
     - For each candidate:
       - Stamp `autoTriedAt` first, so a failure is never retried in a loop.
       - Draft with `fast`, the desk voice, and the same source-copy check, retry/escalation and cross-desk check as `draftNewsAction`. Extract that shared logic into one function both call.
       - Store the `NewsDraft` with `auto: true`, set the item to DRAFTED, and count a `draft`.
       - If a draft still fails the COPY check, leave the item NEW and move on.
     - In `PUBLISH` mode, within budget, for each new draft:
       - `renderAndStoreCard`;
       - `publishForWorkspace({ id, kind: "NEWS", role: "OWNER" }, { caption: headline + "\n\n" + body, targets: autoTargets ∩ connected ∩ ["FB","IG"], media: the card image, newsDraftId })`;
       - on success, set `lastAutoAt` and write an AuditLog `news.autopilot_published`;
       - on failure, write the error to an AuditLog and leave the draft DRAFTED for a person.
     - Never include `"TT"` or `"YT"`.
   - Every failure is caught per item; one bad story never stops the tick.
2. **Settings UI.** In the newsroom settings, add a card `ئۆتۆپایلۆت`.
   - Mode chips:
     - `کوژاوە`;
     - `ڕەشنووسی خۆکار`;
     - `بڵاوکردنەوەی خۆکار`. On LITE / MANUAL this one is disabled, with the hint `تەنها لە پلانی پرۆ و دامەزراوە` and a link to `/newsroom/billing`.
   - Targets: checkboxes `فەیسبووک`, `ئینستاگرام` (only the connected ones are enabled), and two disabled rows:
     - `تیکتۆک — بە پێی یاساکانی تیکتۆک، هەر پۆستێک دەبێت خۆت پەسەندی بکەیت`;
     - `یوتیوب — تەنها ڤیدیۆ وەردەگرێت`.
   - Number inputs: `زۆرترین پۆستی خۆکار لە ڕۆژێکدا` (1–200) and `کەمترین ماوە لە نێوان دوو پۆست (خولەک)` (1–120).
   - A `gm-note warn`: `ئۆتۆپایلۆت بێ پێداچوونەوەی مرۆڤ بڵاو دەکاتەوە. AI تەنها ڕاستییەکانی سەرچاوەکە دەنووسێتەوە، بەڵام بەرپرسیارێتی ناوەڕۆک لە سەر کەناڵەکەتە. سەرەتا «ڕەشنووسی خۆکار» تاقی بکەرەوە.`
   - Saving `PUBLISH` asks `window.confirm("بڵاوکردنەوەی خۆکار چالاک بکرێت؟")`.
   - Also show the plan's refresh speed, and a line `بابەت و سەرچاوەکان لە سەرەوە دیاری دەکرێن`.
   - Action `saveAutopilotAction` needs `can(role, "configure")`, validates everything on the server, and refuses `PUBLISH` when `!canAutoPublish(plan)`.
3. **News page:**
   - a `gm-badge ghost` `خۆکار` on drafts and published items with `draft.auto`;
   - in the published tab, a quiet link `تیکتۆک` to `/newsroom/publish?draft=<id>` for auto-published items.

Commit(s): "Add the newsroom autopilot".

## Task 7: Hand-off (controller)

1. Review (money, safety and publishing paths first).
2. Show the migration SQL (additive).
3. The owner runs `npx prisma db push`. The controller pushes master.
4. Verify:
   - the GitHub cron run shows `/api/cron/news` returning JSON;
   - the billing page lists the features;
   - on the owner's test desk, auto-draft produces a draft.
5. Auto-publish is switched on only by the owner, from the settings card.
