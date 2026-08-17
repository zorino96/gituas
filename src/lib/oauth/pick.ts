/** Choosing which stored credential to act with.
 *
 *  Every loader used to order by `lastUsedAt: { sort: "desc", nulls: "last" }`,
 *  which quietly breaks reconnecting: a credential written seconds ago has a
 *  null `lastUsedAt`, so it sorts BEHIND an older row — including one that has
 *  expired. The screen then tells someone who has just reconnected to
 *  "reconnect it on Integrations", and doing so again changes nothing, because
 *  each reconnect adds another row that loses the same way.
 *
 *  The newest row is the one the account owner just authorised, so that is the
 *  one to use. */
export const newestFirst = { updatedAt: "desc" } as const;

/** Rows that can still be used right now: no expiry, or not yet expired.
 *  For providers with no refresh path (TikTok, Instagram, Facebook Pages, Meta
 *  ads) an expired row is dead weight — skip it in the query rather than
 *  picking it and then rejecting it. Call this per query: it reads the clock. */
export function unexpired() {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

/** Rows that are usable *or* revivable — expired is fine when a refresh token
 *  can trade it for a live one. Use with providers that refresh (YouTube). */
export function usableOrRefreshable() {
  return {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
      { refreshTokenEncrypted: { not: null } },
    ],
  };
}
