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

## Not in scope

| Deferred | Why |
|---|---|
| WhatsApp Business API | v1 measures handoff demand with `wa.me` links first. See TODOS. |
| Publishing and AI content | Merchants already film their own videos; not their bottleneck. |
| Orders, courier, COD | Deals close on WhatsApp; an order table fed from DMs would sit empty. |
| Ad targeting | No ads permissions, and merchants cannot pay Meta without an international card. |
| Self-serve onboarding | v1 onboarding is operator-assisted (see Onboarding). |
| Approval queue UI | Replaced by auto-send-or-stay-silent (see Policy). |
| Meta app rename | The app's approved use case should not move while permissions are fresh. |

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
