---
status: DRAFT — awaiting owner review
date: 2026-09-21
supersedes: the indie-software product direction
---
# Design: the reply machine (v1 of the merchant pivot)

Gituas stops being marketing automation for indie software makers and becomes a
reply layer for small merchants who sell on Instagram and Facebook. This
document covers v1 only. Market reasoning, pricing and rollout live outside this
repo; this file is the technical design.

## The problem

A merchant posts a product without a price. Comments fill with "how much?" in
Sorani, Badini and Arabic. Every unanswered one is a lost sale, and answering
them is not something a person can do while running a shop.

v1 answers those questions in seconds, in the language they were asked in, and
hands the buyer to WhatsApp to close.

## In scope

1. Facebook/Instagram sign-in that doubles as the account connection.
2. Catalog: products with variants and prices; posts tagged to products.
3. Event-driven replies to comments and DMs across Facebook Pages and Instagram.
4. A WhatsApp handoff link carrying product and price, and a count of handoffs.
5. A mobile, right-to-left merchant app in Sorani and Arabic.
6. Publish once to Facebook, Instagram and TikTok from one composer.
7. Insights: followers, reach, which post drew the most questions, handoffs.
8. Hide or delete abusive and spam comments.

Items 6-8 were added on 2026-09-22, after the owner pointed out that the
first cut used 8 of the 13 permissions we hold and left the five hardest-won
idle — including the TikTok Direct Post approval that took five attempts. The
distinction that matters: **publishing is not content creation.** The merchant
already films the video; what they cannot do is upload it three times, in three
apps, with the right caption each time. The publishing code and the Post to
TikTok screen already exist.

## Not in scope

| Deferred | Why |
|---|---|
| WhatsApp Business API | Needs a new Meta application; v1 measures demand with plain `wa.me` links instead. See TODOS. |
| AI content generation (scripts, generated images) | Merchants film their own product; the composer suggests a caption, it does not invent the post. |
| Orders, courier, COD | Deals close on WhatsApp; an order table fed from DMs would sit empty. |
| Ad targeting | No ads permissions, and merchants cannot pay Meta without an international card. |
| Self-serve onboarding | v1 onboarding is operator-assisted (see Onboarding). |
| Approval queue UI | Replaced by auto-send-or-stay-silent (see Policy). |
| Meta app rename | The app's approved use case should not move while permissions are fresh. |

## Access boundary — v1 requests nothing new

**Rule for v1: build only on access already granted — and use all of it.** Nothing in this design
asks Meta, TikTok or anyone else for a new permission, feature or review. Four
rounds of Meta review and five of TikTok are enough; the next thing we ship
should not depend on a queue we do not control.

Every capability v1 uses, and the grant it rides on:

| Capability | Granted permission | Status |
|---|---|---|
| Read comments on Page posts and Instagram media | `pages_read_engagement`, `instagram_business_manage_comments` | held |
| Public reply under a comment | `pages_manage_engagement`, `instagram_business_manage_comments` | held |
| **Private reply to a commenter** | `pages_messaging` (Pages); `instagram_business_basic` + `instagram_business_manage_messages` (Instagram) | held, Advanced |
| Read and send DMs | `pages_messaging`, `instagram_business_manage_messages` | held |
| Account name and avatar | `pages_show_list`, `instagram_business_basic` | held |
| Per-store counters and reach | `read_insights`, `instagram_business_manage_insights` | held |
| Publish a post to a Page | `pages_manage_posts` | held |
| Publish to Instagram | `instagram_business_content_publish` | held |
| Publish to TikTok | TikTok `video.publish`, Direct Post audit | held, approved 2026-09-17 |
| Hide or delete a comment | `pages_manage_engagement`, `instagram_business_manage_comments` | held |
| WhatsApp handoff | none — `wa.me/<number>?text=…` is a plain link, not an API | no access needed |
| Operator alerts | own email sender or a Telegram bot token, both self-serve | no review |

Explicitly outside the boundary, and therefore outside v1: the WhatsApp
Business API, Meta's Human Agent tag, and any ads permission. Each needs a new
application. They are in TODOS with what they would cost, so the decision to
apply is a deliberate one taken later — not something the build quietly assumes.

The practical consequences: replies to a commenter who never messaged us go out
as a private reply (one per comment, inside Meta's window), merchant takeover
works inside the 24-hour window only and the UI says so, and the WhatsApp step
is a link the buyer taps rather than a conversation we host.

## What already exists

| Piece | File | Reuse |
|---|---|---|
| Webhook ingest, signature check, comment + DM upsert | `src/app/api/meta/webhooks/route.ts` | yes, extended |
| Comment reply and DM send, both platforms | `src/lib/publishers/{facebook,instagram}-engage.ts`, `reply-sender.ts` | yes, behind a new shared client |
| Autonomy switches | `ProjectMode.replyMode` / `commentMode` | yes, moved to `Store` |
| OAuth + AES-256-GCM token vault | `src/lib/oauth/flow.ts`, `src/lib/vault.ts` | yes |
| Gemini client and AI budget | `src/lib/gemini.ts`, `ai-budget.ts` | yes |
| Private reply (comment → DM) | — | **new** |
| Outbox / retry | — | **new** |
| Tests | — | **none exist** |

About 70% of the pipeline is already built. What is missing is the part that
makes it a product.

## Data model

```
Tenant ──┬── Store ──┬── Product ──── ProductVariant
         │           ├── PostTag        (size/colour → price, stock)
         │           ├── Conversation ── ConversationMessage
         │           └── OutboxJob
         └── Membership
```

- **Store** — connected page/IG account, delivery cities and fees, hours,
  language, autonomy mode, daily cap, WhatsApp number, status.
- **Product** — name, description, photos. Price lives on **ProductVariant**
  (size/colour carry different prices), with currency: merchants quote IQD and
  USD in the same breath, so money is `{ amountMinor, currency }` and templates
  format Arabic-Indic or Western digits per store language.
- **PostTag** — `(storeId, platform, externalPostId) → productId`. This is how a
  bare "چەندە؟" resolves to a price: the comment carries no product, the post
  does. The webhook already captures the post/media id.
- **Conversation / ConversationMessage** — reuse the existing model, plus
  `intent`, `language`, `resolvedProductId`, and the comment→DM binding
  (`sourceCommentId`, participant id).
- **OutboxJob** — `(messageId unique, attempts, nextAttemptAt, lastError)`.

**Migration warning.** `ConversationMessage.projectId` is required and cascades
from `Project` (`prisma/schema.prisma`). `ApprovalRequest`, `AuditLog`,
`ContentPost`, `MarketingPlan`, `AdCampaign` and `Earnings` hang off it too.
Dropping `Project` is a three-step migration — add `storeId`, backfill, then
drop — not a cleanup.

## The pipeline

```
Meta webhook ──▶ verify signature ──▶ upsert message (idempotent on message id)
                                             │
                                             ▼
                                      enqueue OutboxJob
                                             │
                       ┌─────────────────────┴───────────────────┐
                       ▼                                         ▼
          after() / waitUntil: try now              cron sweep: retry with backoff
                       │
                       ▼
        classify: intent + language  (LLM, structured output only)
                       │
                       ▼
        resolve product: PostTag lookup ── miss ──▶ flag for merchant, stop
                       │
                       ▼
        compose: template(language, intent) + variant price from the database
                       │
                       ▼
                 policy gate
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   send (safe set)           stay silent + flag
          │
          ▼
  public comment reply + private reply, or DM
          │
          ▼
  if intent = order → append WhatsApp handoff link, count it
```

Shadow paths: a message with no text (sticker, photo) → no intent → flagged. An
empty catalog → every message flagged, and the merchant sees why. An upstream
LLM failure → two retries, then flagged; never silent.

### Why the model never writes numbers

The LLM returns `{ intent, productHint, language, confidence }` and nothing
else. The outgoing text is assembled from per-language templates with the price
read from `ProductVariant`. A hallucinated price is therefore impossible rather
than improbable, and the assembly is unit-testable.

### Policy

| Intent | Action |
|---|---|
| price, delivery, sizes/colours, address, hours | send |
| order | send + WhatsApp handoff link |
| discount, complaint, authenticity, low confidence, unknown product | stay silent, flag the thread |

There is no approval queue in v1. Silence is safe and costs nothing to build;
a queue costs a UI, a cancellation race against merchant takeover, and merchant
training, all for the rarest case.

Merchant takeover pauses automation on that thread. Outside Meta's 24-hour
window the merchant cannot reply at all — that needs the Human Agent tag, which
is a separate Meta review (TODOS). The UI says so rather than failing silently.

## The WhatsApp handoff

The only WhatsApp in v1 is a link. No API, no review, nothing to apply for.

**Merchant setting.** Each store has one WhatsApp number, entered during setup
and editable in settings. Stored normalised to international digits: strip
spaces, `+` and punctuation, turn a leading `0` into `964`, reject anything that
is not 10-13 digits. The settings screen shows the number back as the buyer will
reach it, plus a "send yourself a test message" button, because a wrong digit
here silently sends every buyer nowhere.

**What the buyer gets.** When the intent is `order`, the reply ends with a link.
The link points at our own short redirect, not straight at `wa.me`:

```
https://<our domain>/w/<token>   ──302──▶   https://wa.me/964XXXXXXXXX?text=<prefilled>
```

The prefilled text names the product and the price the buyer was just quoted, so
the merchant opens WhatsApp already knowing what the conversation is about.

**Why our own redirect.** A raw `wa.me` link cannot be counted. The redirect is
what produces the handoff number, and that number is the evidence for whether
the WhatsApp Business API is ever worth applying for. Each token records store,
conversation, product and price, and one row per tap.

**What it does not do.** We do not host the WhatsApp conversation, cannot read
it, and cannot tell whether the sale closed. The merchant answers from their own
phone as they do today. v1 measures how many buyers we hand over, not what
happens after.

## Errors

Meta error codes are preserved through a single shared client, because each
needs a different rescue:

| Failure | Rescue | Merchant sees |
|---|---|---|
| Invalid/expired token (190) | pause the store | "Reconnect your page" |
| Rate limit (613, 4) | backoff and retry | nothing |
| Outside 24h window | fall back to a public comment reply; for a DM-only thread, flag | nothing |
| Comment deleted (100) | drop the job | nothing |
| LLM empty or invalid JSON | 2 retries, then flag | "This one needs you" |
| Unknown product | flag immediately | "Tag this post to a product" |
| Outbox job stuck | push alert to the operator | banner in the app |
| Daily cap reached | pause auto-send, keep ingesting | "Your post is taking off" |

Two invariants: no failure is silent, and no failure sends the wrong thing.

## Limits

Per-store daily reply cap, configurable. At the cap auto-send pauses, ingestion
continues, the merchant is told. This protects the AI bill and, more
importantly, the shared Meta rate budget — every store runs on one Meta app, so
one viral store can otherwise stall every other store.

## Onboarding

The chain that must all be true before a single message arrives:

```
Facebook sign-in → merchant is a Page admin → Instagram account is Professional
   → Instagram is linked to that Page → "Allow access to messages" is ON in the
     Instagram mobile app  ← manual, no API, and webhooks are silent when off
   → at least one product exists → recent posts tagged to products
```

The last toggle cannot be set programmatically and produces no error when off;
it is the most likely support call. v1 is operator-assisted: the operator walks
each merchant through this, imports products from their existing posts, and tags
the recent ones. The app surfaces the state of every step so the gap is visible.

## Observability

Per store: messages in, auto-replied, flagged, median latency, handoffs,
cap hits. Per reply, a trail: message → intent → product → template → sent id,
so a complaint three weeks later can be reconstructed.

Alerts to the operator when the outbox stalls or nothing has been processed for
N hours. The existing hourly cron was never scheduled in any config and nobody
noticed for months — silence is the failure mode this project actually has.

## Testing

- **Deterministic unit tests** (CI): template and price assembly, money
  formatting per currency and digit style, the policy gate, error mapping,
  outbox idempotency and backoff.
- **Integration test**: webhook → outbox → send, with Meta mocked.
- **Eval set** (run deliberately, not in CI): real Sorani, Badini, Arabic and
  Latin-script messages with expected intent, scored against an accuracy
  target. Classification is nondeterministic; treating it as a unit test
  produces flaky tests that get disabled.

The corpus has to be collected before the code needs it — from the operator's
own inbox work with the first merchants.

## Deployment

1. Additive migration (new tables, `storeId` columns).
2. Deploy; backfill Store from the existing connection.
3. Cleanup migration drops `Project` and its dependants.

`vercel.json` does not exist in this repo, which is why the cron never ran. It
is created in step 2 with the sweep schedule. Immediate execution uses
`after()`; a sub-daily cron requires a Vercel plan that allows it — confirm
before relying on the sweep for latency rather than for recovery.

Rollback is `git revert` plus redeploy; the additive tables are harmless if
left behind.

## Open questions

- Monthly price, and whether the first merchants pay at all during the pilot.
- Which Vercel plan the project is on (cron frequency depends on it).
- Who writes and reviews the Sorani, Badini and Arabic template copy.
