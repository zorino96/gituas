# TODOS

Deferred work, with the context needed to pick it up cold.

## Testing

- **No test harness exists.** Zero test files, no runner in `package.json`.
  Deferred on 2026-08-26 during the App Review review: a unit test would not
  have caught the bug that prompted the question (`page_impressions` was a
  valid metric when it was written; Meta deleted it later). The fix that does
  catch that class of bug — surfacing the insights error instead of swallowing
  it — shipped instead. Revisit once the App Review submissions are settled.
  - When picked up: `vitest`, and start with `readMetricValue()`, the follower
    fallback chain, and the zero-metric filter in `facebook-engage.ts`.

## Performance

- **`loadFacebook` makes up to 10 sequential Graph calls** (page fields,
  insights, feed, up to 5 comment fetches, conversations). The engagement page
  takes ~18s to load. The Graph API can nest these — a single
  `/{page}?fields=fan_count,followers_count,feed.limit(6){...}` would collapse
  two of them. Not urgent; noted 2026-08-26.

## Meta compliance

- **MyApp (1504338996606998) has a past-due Data Use Checkup** -- deadline
  Jun 2, 2024, and its API access is restricted as a result. This is NOT the
  Gituas app; Gituas has no required actions. Earlier notes wrongly placed this
  checkup on Gituas, misreading the account-wide "Required actions" counter as
  a per-app flag. Certifying data use for MyApp needs someone who knows what
  MyApp does.
- **A Facebook-only tenant cannot be resolved from Meta's data-deletion
  `signed_request`.** The callback matches on the Instagram credential's
  `providerAccountId`; a tenant with only a Page connected has no such row.
  Closing this needs a nullable column, deliberately deferred while App Review
  submissions are open. See `src/app/api/meta/data-deletion/route.ts`.

## Domains

- Meta and TikTok redirect/callback URLs still point at `gituas.vercel.app`.
  Both verdicts have landed (Meta 2026-09-06, TikTok 2026-09-17), so both are
  free to move to `gituas.com`. Changing a redirect URI in the TikTok portal
  goes through `Create Revision` and its own review; do it deliberately.

## In flight — check, don't redo

- ~~Meta App Review, submitted 2026-08-27.~~ **APPROVED IN FULL, 2026-09-06
  09:32 GMT+3.** All four permissions granted -- `pages_read_engagement`,
  `pages_manage_engagement`, `pages_manage_posts`,
  `instagram_business_content_publish` -- and all eight renewals renewed.
  "Our review is complete and your requests and app settings were approved."

  Four rounds; ten days on the last one. What changed on the winning round:
  one 46-57s screencast per permission instead of one four-minute video for all
  four, each a single unbroken take of consent -> the one action -> the result
  on facebook.com or instagram.com. The three permissions that passed in
  earlier rounds all had that shape; the four that failed did not.
  `pages_read_engagement` also needed the panel fix in `d4ba2b4` -- until then
  its demo screen read "no insights available yet", because the code was asking
  for metrics Meta had deleted.

  Videos and submission text: `Desktop/tiktok-audit/`.

- ~~TikTok Content Posting API - Direct Post.~~ **APPROVED 2026-09-17 06:47**
  (ref `20260911123331`), six days after the hand-recorded resubmission:
  "The audit is completed and you can now launch your integrations." The portal
  now reads "Provisioned access for your users" and the SELF_ONLY restriction
  is gone. Confirms the support answer: the agent-recorded videos were the
  cause. Nothing in the code needed to change — the Post to TikTok screen
  already offers exactly what `creator_info` returns.

  **Visibility on @rwbn26 is capped by the account itself, not by us.** The
  take-2 video shows `creator_info` offering Followers / Friends / Only me and
  no "Everyone", and tiktok.com titled the profile "This account is private".
  TikTok omits `PUBLIC_TO_EVERYONE` for private accounts. Switch the account to
  public in the TikTok app if Gituas posts from it should reach everyone.

  Not covered by this approval, and not built: paid promotion (Spark Ads,
  boosting). That is the TikTok for Business Marketing API — a separate
  developer registration and review. The commercial-content disclosure
  (`brand_organic_toggle` / `brand_content_toggle`, `src/lib/publishers/tiktok.ts:320`)
  is part of Direct Post and now usable, since branded content cannot be
  Only me.

  History, kept because it records what did and did not cause the rejections:

  **Cause found 2026-09-11.** Four
  rejections (Aug 10, Aug 17, Aug 24, and Sep 8 — ref `20260830225508`), each
  with the same generic line and an empty "Review comments" tab. Support case
  `0933be8a90c8304b` finally answered:

  > demo videos submitted for review should not be recorded using AI agents or
  > automated tools. You should manually click, navigate, and walk through the
  > entire demo yourself

  Every TikTok demo video was produced the same way: Claude driving Chrome over
  CDP, then cut and sped up 1.5-2.5x. What a reviewer sees — a cursor that never
  moves while buttons get pressed, text appearing in a single frame, jump cuts —
  says automation. That explains four identical rejections better than anything
  guessed before, and it is TikTok's own words rather than an inference.

  **Recorded 2026-09-11 by the owner**, following
  `Desktop/tiktok-audit/tiktok-manual-recording.md`. Two takes, both kept in
  `Desktop/tiktok-audit/`:

  - `gituas-tiktok-manual-raw.mp4` (take 1, 2:10) — failed our own check.
    TikTok still held the old grant, so the consent screen said "Gituas
    already has some access" and never listed the scopes; and a Chrome
    "delete group?" dialog showed the owner's email at 1:50. A copy with the
    email blurred is `gituas-tiktok-manual-take1-blurred.mp4`.
  - `gituas-tiktok-manual-take2-raw.mp4` (take 2, 2:21, 42.3 MB) — **the one to
    submit, unedited.** Access was revoked on TikTok's side first, so the
    consent screen lists both scopes ("Access your profile info", "Post
    content to TikTok"). Every step of the shot list is on screen, the tab
    strip holds only Gituas and TikTok, no notifications, silent audio. A
    Windows clipboard panel is open for 1.5 s at 1:07 while the owner pastes
    `#gituas`; its contents are harmless.

  **Submitted 2026-09-11 15:33, ref `20260911123331`** — Direct Post now shows
  "Under review"; TikTok says 2-4 weeks. Filled and submitted by Claude at the
  owner's request: TikTok's rule covers recording the demo, not filling the form.
  - Uploaded `gituas-tiktok-manual-take2.mp4` (9.3 MB): take 2 re-encoded only
    to fit the browser tool's 10 MB upload cap — same frames, same 2:21, no
    cuts. The unedited original stays beside it as `...-take2-raw.mp4`.
  - The form is the Aug 27 answers reused, checked against the code (vault
    AES-256-GCM in `src/lib/vault.ts`; disconnect deletes the credential,
    `integrations/actions.ts:143`). One paragraph changed: the reason for
    reapplying now cites support case `0933be8a90c8304b` and says the earlier
    screencasts were agent-recorded and this one was recorded by hand.

  Lesson for any future take: disconnecting in Gituas does not revoke the grant
  on TikTok's side. Remove the app from the TikTok account first, or the
  consent screen hides the scopes behind "already has some access".

  What follows is the earlier investigation, kept because it rules things out.

  **The `video.upload` hypothesis is dead.** It was the reason given for the
  fourth attempt: the app asked for a scope it never called, and TikTok's
  guidelines say every requested scope must be demonstrated or removed. Two
  things were wrong with it.

  1. The scope was dropped from `src/lib/oauth/registry.ts` in `64c4265` and
     deployed, but **never from the portal** — so the reviewer saw an app still
     requesting all three, and the submission text's claim that the scope "has
     been removed" was true of the code and false of what was under review.
  2. Checking the portal to fix that showed it **cannot be removed at all.**
     The Scopes list is derived from the products, not chosen: each row is
     labelled `Included in Login Kit` or `Included in Content Posting API`, and
     none has a remove control. The Content Posting API panel states it
     outright — *"By default, Upload to TikTok is enabled, allowing you to
     upload content to TikTok as a draft"* — with Direct Post as the optional
     add-on on top. Every Content Posting API app carries `video.upload`.
     It cannot be what distinguishes a rejected app from an approved one.

  So four attempts have produced no evidence about the actual cause. The next
  one must not be another guess: it needs either reviewer text (Contact Support
  is the only route left, since the comments tab has been empty every time) or
  a change that is defensible without knowing the reason.

  **Support ticket raised 2026-09-08, case `0933be8a90c8304b`** (Category:
  Support, Topic: Content Posting API, App: Gituas). It asks for the specific
  reason `20260830225508` was rejected, whether the objection was to the video,
  the description, or the integration, and how a scope that cannot be removed
  from the portal should be handled if every listed scope must be demonstrated.
  TikTok says 1-3 days. Answered 2026-09-11 — see the top of this entry.

  Keep in the code anyway: the registry now asks for only what it exercises,
  which is correct regardless of the portal. The consent-screen mismatch it
  created (two toggles in the app, three in the old video) resolves itself: the
  hand-recorded take shows the current screen.

- The Draft revision created 2026-09-08 to inspect the scope fields no longer
  exists; the app page showed `Create Revision` again on 2026-09-09, so nothing
  is pending in the portal. The distinction it taught still matters:
  `Submit for review` reviews the app configuration and freezes the app while
  it is under review, which would block `Reapply`; `Reapply` requests the Direct
  Post audit that lifts SELF_ONLY. Only `Reapply` is what Gituas needs.

## Multi-tenant readiness

The twelve Meta permissions approved 2026-09-06 are what let Gituas serve
someone other than the owner. That path had never been walked. Mapping it
turned up one dead end, now fixed, and one latent fault left alone on purpose.

- ~~No code path created a Project.~~ **Fixed 2026-09-06.** A new account got a
  Tenant from the signIn callback and then hit a dashboard whose every surface
  hangs off a project it could not make: `/dashboard/projects` rendered
  "No projects yet." with no control, and the dashboard's "+ adopt project"
  link pointed there. Invisible until now because this workspace's only project
  was inserted by hand. Form + server action in
  `src/app/dashboard/projects/{actions.ts,new-project.tsx}`; verified live by
  creating and then deleting a test project.

- **`Tenant.ownerId` has no unique constraint** (`prisma/schema.prisma:339`).
  All fifteen session-based lookups use `findFirst({ where: { ownerId } })`, so
  if the signIn callback ever ran twice concurrently for one user, that user
  would own two tenants and different screens could resolve different ones.
  Harmless today with a single user. Fixing it means a DB migration, deliberately
  deferred while the TikTok Direct Post audit is open — the app should not change
  shape under a reviewer. Do it once TikTok's verdict lands.
  - When picked up: add `@@unique([ownerId])`, backfill/merge any duplicate
    tenants first, then switch the fifteen `findFirst` calls to `findUnique`.

- **Still untested end to end:** nobody but the owner has ever signed in,
  created a project, connected their own Page or Instagram account, and pushed
  a post through. That is the real proof the approval bought, and it needs a
  second GitHub account and a second Facebook Page.

## Deferred by the 2026-09-21 CEO review (merchant pivot)

Recorded when the product pivoted from indie-software marketing to reply
automation for Iraqi/Kurdish merchants. Full design: see the pivot spec.

- **WhatsApp Business API — P1, effort L (AI: M), deliberately not now.**
  Iraqi deals close on WhatsApp, not in Instagram DMs; our own market research
  says so and every competitor (ManyChat, Chatfuel, RABT Labs) has it. v1 ships
  a counted handoff link instead, which needs no permission at all.

  **The trigger for applying is revenue, not appetite.** Apply once the product
  is earning and the handoff counter shows buyers actually use it. Until then
  the link is strictly better: it costs nothing and it produces the evidence the
  application would need.

  What applying costs, so the decision is made with open eyes: serving merchants'
  own numbers needs `whatsapp_business_messaging` and `whatsapp_business_management`
  at **Advanced access**, which means an App Review submission with a separate
  demo video per permission. Meta bundles currently-held permissions into any
  submission as "Existing access for renewal" and they cannot be removed — in the
  2026-08-27 round, 8 existing permissions rode along with the 4 new ones. So a
  WhatsApp application puts all 12 approved permissions back in front of a
  reviewer, against an app whose product has since changed. When we go, go once:
  updated app description, WhatsApp permissions, and hand-recorded videos, with
  live merchants to point at. Also unconfirmed and worth checking first: whether
  Tech Provider status is additionally required.

- **Page/IG token refresh — P1, effort S.** The v1 failure handler is "token
  invalid -> pause the store and notify the merchant", with no renewal path.
  Merchants will not re-authorise on their own, and a paused store looks
  exactly like a quiet one. Needs scheduled refresh before expiry plus a
  reconnect prompt that survives the merchant ignoring it.

- **Human Agent tag — P2, effort M.** Replying outside Meta's 24-hour window
  (up to 7 days) requires this tag, which is a separate Meta feature review.
  v1 limits merchant takeover to inside 24 hours and says so in the UI. Worth
  applying for once there are live merchants to describe in the request.

- **App-level integrity protection — P2, effort M.** Every store shares one
  Meta app. Near-identical template replies fired at many recipients is the
  canonical spam signature, and one abusive merchant can get the app
  restricted — which would stop every other store and put the 12 approved
  permissions at risk. Needs template variation, an app-wide rate ceiling on
  top of the per-store cap, and a review step before a new store's auto-send
  is enabled.
