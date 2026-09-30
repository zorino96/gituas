---
status: DRAFT — awaiting owner review
date: 2026-09-30
builds-on: 2026-09-21-merchant-reply-machine-design.md
---
# Design: shop comment automation (phase A)

The shop answers comments and DMs on the merchant's Facebook Page and Instagram
account by itself: a public reply under the comment, a private message with the
product card, a thank-you for praise, and silence plus a flag for anything a
person should handle. It must beat the local comment bots merchants already pay
for on every feature they have, and add what none of them can do: replies in the
buyer's own language and a product card whose numbers come from the database.

This builds the 2026-09-21 reply machine (never implemented) and changes it
where the owner decided differently on 2026-09-30. Where the two disagree, this
document wins. Pricing and competitor notes live outside this repo.

## Decisions taken with the owner (2026-09-30)

| Question | Decision |
|---|---|
| Public reply text | The merchant writes 2–5 sample replies; the AI rewrites one each time in the commenter's language and script. No numbers, ever. |
| Private message | A **product card**: price, sizes/colours, delivery fee and time, photos — typed by the merchant, assembled by a template. The AI writes only the greeting. |
| Which posts | **Every post is automated by default** until it is `expiryDays` old (30, configurable), counted from the post's own creation time. The merchant can change or switch off any post. |
| One behaviour or by type | **By type** (see Behaviour). |
| Approach | Build the 2026-09-21 reply machine with these changes, not a per-post rule table. |

## Scope

In:
1. Automatic handling of comments and replies-to-comments on Facebook Page posts,
   videos and reels, and Instagram posts and reels.
2. Private reply to the commenter (comment → DM), with a Facebook card carousel.
3. Automatic answers to follow-up DMs in a thread that began with a product card.
4. Products with variants, attached to posts (the "product card").
5. Automation templates: a store default plus named templates, overridable per post.
6. Stop controls: store switch, per-post switch, "stop everything now",
   "stop posts before a date", automatic expiry.
7. Per-plan limits (Free / Merchant / Pro), set by the operator.
8. Webhook subscription on connect, so automation works for pages other than ours.

Out (later phases): payment and self-serve plan purchase, Arabic and Badini UI,
orders/COD table, post scheduling, TikTok comments (no API), WhatsApp Business API.

## Platform facts this design depends on

Checked against Meta's docs on 2026-09-30.

| Fact | Consequence |
|---|---|
| Private reply: `POST /{page-id}/messages` (FB) or `/{ig-id}/messages` (IG) with `recipient: {comment_id}` | One code path per platform in the shared client. |
| **One** private reply per comment, within **7 days** of the comment | Private replies only for comments < 7 days old; never retried after a success. |
| No further messages until the person answers; then the 24-hour window applies | Product photos (IG) and follow-ups are sent only after the buyer replies. |
| FB private replies accept **any Send API message**, including a generic template | FB card: image, title, subtitle (≤ 80 chars), WhatsApp button; up to 10 elements as a carousel. |
| IG private replies are **text only** | IG card is text; photos follow once the buyer replies. |
| IG private replies need `instagram_business_basic` + `instagram_business_manage_comments` | Both held. |
| Liking a comment: FB `POST /{comment-id}/likes` (`pages_manage_engagement`); IG has no API | "Like" is Facebook-only; the setting says so. |
| Webhooks fire only for subscribed accounts: FB `POST /{page-id}/subscribed_apps` (`feed,messages`), IG `POST /me/subscribed_apps` (`comments,messages`) | Subscribe on connect and on reconnect. **Nothing in `src/` does this today**, so comment webhooks currently arrive only for the app's own test accounts. |
| IG DMs reach us only if "Allow access to messages" is on in the Instagram app | Setup checklist shows it; it cannot be set by API. |

Verify with one real call during the build: the FB comment-likes endpoint and a
generic template as a private reply.

## Behaviour

### Gate — before anything runs

1. The comment's author is the store itself (Page id or IG user id) → ignore.
   This prevents the bot answering its own replies. There is no such check today.
2. The post is automated: its `PostAutomation` is enabled, not expired, and
   within the plan's active-post slots (the **N newest posts** by post creation time).
3. This author has not already received an automatic reply on this post in the
   last 24 hours.
4. The store's automation switch is on, the store's daily cap is not reached, and
   the merchant has not taken over the thread (a manual reply pauses it).

A comment that fails the gate is stored and shown in the inbox as usual. Nothing
is sent.

### Classify

A cheap model returns labels only, as JSON — never text for the buyer:

```
{ type, intent, language, confidence }
type:     QUESTION | ORDER | PRAISE | NEGOTIATION | COMPLAINT | ABUSE | SPAM | OTHER
intent:   price | delivery | size_colour | address | hours | availability | none
language: ckb (Sorani) | kmr (Badini) | ar | ku_latn | en
```

### Act

| Type | Public reply | Private reply | Other |
|---|---|---|---|
| QUESTION | varied sample | product card, or the store's default DM | like (FB) |
| ORDER | varied sample | product card + WhatsApp link | like (FB) |
| PRAISE (incl. emoji, tagging a friend) | varied thank-you | — | like (FB) |
| NEGOTIATION, COMPLAINT, low confidence | — | — | flag: "needs you" |
| ABUSE, SPAM | — | — | flag; hide if the store's auto-hide is on |
| OTHER | — | — | flag |

- **Varied sample**: the AI rewrites one of the template's samples in the detected
  language. A guard rejects any output containing a digit (Western, Arabic-Indic
  or Persian) or longer than 300 characters. On rejection or model failure, the
  sample is sent verbatim. On Instagram the reply starts with `@username`.
- **Product card**: see Composition.
- **No product card on the post** → the store's default DM (merchant-written text).
  If there is none, the private reply is skipped and the post is flagged "add a
  product card".
- **Timing**: each job waits a random 10–40 s before sending, so replies read as
  human and a burst of comments is spread out.

### Follow-up DMs

When a buyer answers a private reply, the thread is bound to that post's product.
- **First answer**: send the product photos (up to 5; IG needs this because its
  private reply was text), then handle the answer itself like any later DM.
- **Later DMs**: classify. Price, delivery, size/colour and availability get the
  template answer from the product; ORDER gets the WhatsApp link. Anything else is
  flagged.
- DMs with no bound product are flagged, never guessed at.

### Composition — the model never writes numbers

The outgoing private text is assembled per language from fixed templates:

```
{greeting}                                  ← AI, digit guard, optional
{product name}
{price line per variant}                    ← ProductVariant.amountMinor + currency
{sizes/colours in stock}
{delivery: fee, time}                       ← Store settings
{WhatsApp link}  (ORDER, or always if the store chooses)
```

Money is formatted per language: Arabic-Indic digits for `ckb` and `ar`, Western
digits for the others. IQD has no minor unit and USD has two; the
`src/lib/money.ts` exponent table is reused.

The Facebook card is a generic template with one element per product photo (max
10): image = photo, title = product name, subtitle = price and delivery (≤ 80
chars; the builder truncates at a word boundary), button = the WhatsApp link. If
the template is rejected, the same content is sent as text.

The WhatsApp link is the existing counted redirect `/w/<slug>?t=<text>`, where
`<text>` names the product and the quoted price.

## Merchant screens (Sorani)

- **Automation** (`/app/automation`, new):
  - store on/off; "stop everything now"; "stop posts published before …";
  - expiry days (default 30); like on/off; auto-hide spam on/off;
  - delivery fee and time; default DM;
  - the default template's public samples (2–5) and thank-you samples (2–5);
  - plan usage: active posts n/N, automatic replies today n/cap.
- **Templates**: list, create, edit, delete, and "apply to post"; one is the default.
- **Products** (new): name, up to 5 photos (Vercel Blob), variants (label, price,
  currency, in stock).
- **Posts** (the existing comments page gains a row header per post): automation
  on/off, product card picker, template picker, "active until".
- **Composer**: optional product card at publish time, so a post published from
  Gituas is tagged before its first comment arrives.
- **Inbox**: a "needs you" filter with the reason; an "answered automatically"
  badge on handled comments; replying by hand pauses automation for that thread.
- **Setup checklist**: page connected; webhooks subscribed; Instagram message
  access on; at least one product; a default template with samples.

## Data model

Additive; `prisma db push` against production, as for the newsroom.

```
Tenant ── Store ──┬── Product ── ProductVariant
                  ├── AutomationTemplate
                  ├── PostAutomation        (one per post we have seen)
                  └── OutboxJob
ConversationMessage  + storeId, classification, binding
```

- **Store**:
  - `tenantId`, `fbPageId?` (unique), `igUserId?` (unique), `plan` (FREE | MERCHANT | PRO);
  - `automationEnabled` (default false for existing tenants), `expiryDays` (30), `dailyCap`;
  - `likeComments` (true), `autoHideSpam` (false), `deliveryFeeMinor?`, `deliveryCurrency`,
    `deliveryTime?`, `defaultDm?`, `defaultTemplateId?`, `stopBefore?` (date), `pausedReason?`.
  - One store per connected Page (+ its linked IG account); a tenant may have several.
  - Created on connect; backfilled from existing `OAuthCredential` rows.
- **Product** (`storeId`, `name`, `description?`, `photos String[]`, `active`) and
  **ProductVariant** (`productId`, `label`, `amountMinor`, `currency`, `inStock`).
- **AutomationTemplate**: `storeId`, `name`, `publicSamples String[]`,
  `thanksSamples String[]`, `dmGreeting` (on/off), `whatsappAlways` (bool).
- **PostAutomation**:
  - `storeId`, `platform`, `externalPostId`, `postCreatedAt`, `enabled` (true),
    `productId?`, `templateId?`, `activeUntil`;
  - `@@unique([storeId, platform, externalPostId])`;
  - created by the composer or lazily on the first comment, reading the post's
    creation time from the API.
- **ConversationMessage** gains:
  - `storeId?`, `authorId?` (platform user id), `parentCommentId?`;
  - `type?`, `intent?`, `language?`, `confidence?`;
  - `outcome?` (AUTO_REPLIED | FLAGGED | SKIPPED), `outcomeReason?`, `boundProductId?`;
  - `@@unique([storeId, externalMessageId])` for idempotent webhook upserts.
  - `projectId` becomes optional, so shop rows no longer need a `Project`. Operator-dashboard
    rows keep theirs and follow the old path unchanged.
- **OutboxJob**:
  - `messageId`, `kind` (PUBLIC_REPLY | PRIVATE_REPLY | LIKE | HIDE | DM_ANSWER | DM_PHOTOS),
    `@@unique([messageId, kind])`;
  - `status`, `attempts`, `nextAttemptAt`, `sentId?`, `lastError?`.
- **Usage** (existing, keyed by month): new metric `ai_vary`. The daily reply
  cap is not a Usage metric; it is counted from today's sent `OutboxJob` rows
  for the store, so no per-day key is needed.

## Components

| Unit | Does | Depends on |
|---|---|---|
| `src/app/api/meta/webhooks/route.ts` | Verify; resolve the Store by page or IG id; drop self-authored; upsert; enqueue; `after()` → process. Store miss → old Project path. | db, `shop/pipeline` |
| `src/lib/shop/gate.ts` | Pure: is this message eligible, and why not | none |
| `src/lib/shop/classify.ts` | Labels via `completeJson` (DeepSeek flash, thinking off; Gemini fallback) | `ai/provider` |
| `src/lib/shop/vary.ts` | Rewrite a sample in a language; digit and length guard; verbatim fallback | `ai/provider` |
| `src/lib/shop/policy.ts` | Pure: (type, intent, product?, settings) → list of actions | none |
| `src/lib/shop/compose.ts` | Pure: DM text per language, FB generic template, WhatsApp text | `money.ts` |
| `src/lib/shop/meta-client.ts` | Private reply (FB template/text, IG text), comment reply, like, hide, send DM + images, subscribe webhooks; maps Meta error codes | existing `*-engage.ts` |
| `src/lib/shop/pipeline.ts` | Runs one message: gate → classify → policy → compose → OutboxJobs → send | all of the above |
| `src/app/api/cron/shop-outbox/route.ts` | Retries due jobs with backoff; alerts on stalls | pipeline |
| `src/app/app/automation/*`, `products/*` | The screens above | server actions |

Pure units (`gate`, `policy`, `compose`) take plain data and are fully unit-tested.

## Plans and limits

The operator sets `Store.plan`; payment is a later phase.

| | Free | Merchant | Pro |
|---|---|---|---|
| Automated posts (newest) | 3 | 25 | all |
| Automatic replies per day | 100 | 1,000 | 5,000 |
| AI-varied replies per month | 30 | 500 | 3,000 |

- When the AI-varied quota is used up, samples go out verbatim. Automation does not stop.
- At the daily cap, sending pauses, ingestion continues, and the merchant is told.
- The cap also protects the shared Meta rate budget: all stores run on one app.

Classification runs on every eligible message; at ~$0.00005 each it is not metered.

## Errors

The 2026-09-21 table applies, with these additions:

| Failure | Rescue | Merchant sees |
|---|---|---|
| Private reply rejected (already sent, or older than 7 days) | mark done; never retry | nothing |
| FB generic template rejected | resend as text | nothing |
| Webhook subscription fails on connect | retry on the next page load; checklist shows it | "Automation can't hear this page yet" |
| Varied reply fails the guard | send the sample verbatim | nothing |
| Store paused (token expired) | jobs wait; resume on reconnect | "Reconnect your page" |

Invariants: no failure is silent, nothing wrong is sent, and no comment gets two
private replies.

## Testing

- **Unit (CI)**:
  - gate: self-author, expiry, N-newest slots, per-author-per-post-per-day, takeover, cap;
  - policy: every type×intent;
  - compose: each language, money digits, variant lines, the 80-char subtitle, the WhatsApp text;
  - the digit guard;
  - outbox idempotency: `@@unique([messageId, kind])`.
- **Integration (CI)**: webhook payload → stored → jobs → sends, with `fetch` to
  Graph mocked. FB comment, FB reply-to-reply, IG comment, self-authored comment,
  DM follow-up.
- **Live (by hand, on the owner's own Page and Instagram account)**: one comment
  of each type in Sorani, Badini and Arabic, checked in the native apps.
- **Eval set** (later, from real comments): classification accuracy per
  language. Not in CI.

## Rollout

1. Additive schema; backfill a Store per connected Page and IG account, with
   `automationEnabled = false`.
2. Ship the screens and pipeline; subscribe webhooks for the owner's own test
   accounts; test live.
3. Turn automation on per store by the operator.
4. Prerequisite before real merchants: the Vercel Pro plan. Hobby is
   non-commercial, and its crons run once a day, so the outbox sweep would only
   recover jobs daily. Immediate sending uses `after()` on either plan.

Rollback: switch `automationEnabled` off for all stores. The additive tables are
harmless.

## Open items

- The owner reviews the Sorani, Badini and Arabic template copy before real merchants.
- Delivery fee per city (Erbil, Sulaymaniyah, Duhok, …) versus one fee. v1 has one fee plus a note.
- Whether an ORDER in a DM should also notify the merchant by Telegram or email (the fields exist on Tenant).
