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

- **TikTok Content Posting API - Direct Post, submitted 2026-08-27.** Fourth
  attempt. The first three failed with an identical generic line and an empty
  "Review comments" tab. The cause found this round: the app requested
  `video.upload` while only ever calling `post/publish/video/init`, and TikTok's
  guidelines require every requested scope to be demonstrated or removed. Scope
  dropped in `64c4265`. Verdict due in 2-4 weeks.
  - **Known mismatch to watch for:** the submitted demo video still shows the
    old three-toggle consent screen; the app now requests two. The submission
    text explains why. If the reviewer objects, re-record only the consent
    segment (~15 min) rather than the whole video.

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
