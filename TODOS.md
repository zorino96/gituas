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
  Meta's verdict has landed, so its URLs are free to move. TikTok's Direct Post
  audit is still open — leave the TikTok redirect URI alone until that verdict
  arrives, since the reviewer was given that URL.

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

- **TikTok Content Posting API - Direct Post: REJECTED a fourth time**
  2026-09-08 06:45 (ref `20260830225508`). Same generic line, "Review comments"
  still empty. Four rejections, zero reviewer text.

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

  Keep in the code anyway: the registry now asks for only what it exercises,
  which is correct regardless of the portal.

  - **Mismatch introduced by that change:** the deployed consent screen shows
    two toggles; the submitted demo video shows three. Harmless while the code
    is the narrower of the two, but re-record the consent segment (~15 min)
    before the next submission so video and app agree.

- **A Draft revision exists in the TikTok portal** (created 2026-09-08 to
  inspect the scope fields; `/app/7648797513306310664/pending`). It is not
  submitted and the Live app is untouched — "live since Sep 8, 2026 6:45 AM".

  **Do not submit it without deciding deliberately.** Submitting a revision puts
  the app into `Under review`, and per TikTok's own portal no further changes
  can be made while it is there — which would block `Reapply`, the separate
  button that requests the Direct Post audit. The two flows are different:
  `Submit for review` reviews the app configuration; `Reapply` asks for the
  audit that lifts SELF_ONLY. Only the second one is what Gituas needs.

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
