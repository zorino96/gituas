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

- **Data Use Checkup unresolved** (Action ID 1741202236995542), outstanding
  across all three App Review submissions.
- **A Facebook-only tenant cannot be resolved from Meta's data-deletion
  `signed_request`.** The callback matches on the Instagram credential's
  `providerAccountId`; a tenant with only a Page connected has no such row.
  Closing this needs a nullable column, deliberately deferred while App Review
  submissions are open. See `src/app/api/meta/data-deletion/route.ts`.

## Domains

- Meta and TikTok redirect/callback URLs still point at `gituas.vercel.app`.
  Move to `gituas.com` once both verdicts land — changing them mid-review
  invalidates the URLs the reviewers were given.
